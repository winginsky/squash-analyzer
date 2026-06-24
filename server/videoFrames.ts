/**
 * Video frame extraction utility.
 *
 * Accepts a local video file path (or a URL for backward-compat), uses ffmpeg
 * to extract evenly-spaced frames across the full duration, uploads each frame
 * to S3, and returns their URLs along with the timestamp (in seconds) each
 * frame was taken from.
 *
 * IMPORTANT: When called from the upload pipeline, always pass the local
 * temp file path instead of the S3 URL to avoid downloading the 800MB video
 * a second time (which causes OOM crashes on the 4GB sandbox).
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { storagePut } from "./storage";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import nodeFetch from "node-fetch";

const execFileAsync = promisify(execFile);

export interface ExtractedFrame {
  /** 0-based index of this frame */
  index: number;
  /** Public S3 / CloudFront URL of the JPEG image (for display in the UI) */
  url: string;
  /** Base64-encoded JPEG data for passing directly to AI (avoids CloudFront auth issues) */
  base64: string;
  /** Timestamp in seconds within the video where this frame was taken */
  timestampSec: number;
  /**
   * Base64-encoded JPEG data (no data-URI prefix).
   * Included so callers can send the image inline to LLM APIs instead of
   * relying on the CDN URL being reachable from the model's servers.
   */
  base64?: string;
  /**
   * Relative motion score (JPEG size / average JPEG size across all frames).
   * Values > 1.0 indicate above-average motion (likely active play).
   * Values < 0.7 suggest low motion (possible game break or static scene).
   */
  motionScore?: number;
}

/**
 * Get the duration of a video file in seconds using ffprobe.
 */
async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    filePath,
  ]);
  const info = JSON.parse(stdout);
  return parseFloat(info.format?.duration ?? "0");
}

/**
 * Extract a single frame from a video at a given timestamp (seconds).
 */
async function extractFrame(
  videoPath: string,
  timestampSec: number,
  outputPath: string,
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-ss", String(timestampSec),
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "3",            // JPEG quality (1=best, 31=worst)
    "-vf", "scale=1280:-1", // max width 1280px, preserve aspect ratio
    "-y",
    outputPath,
  ]);
}

/**
 * Download a video from a URL to a local file path using streaming.
 * Uses node-fetch + stream pipeline to avoid loading the entire file into RAM.
 */
async function downloadVideoStreaming(url: string, destPath: string): Promise<void> {
  const response = await nodeFetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }
  const dest = createWriteStream(destPath);
  await pipeline(response.body, dest);
}

/**
 * Format seconds as MM:SS string (e.g. 75 → "1:15").
 */
export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Extract evenly-spaced frames from a video and upload them to S3.
 *
 * @param videoSource  Either a local file path (preferred for large files) or
 *                     a public URL. When a local path is provided, no download
 *                     occurs — the file is used directly, saving ~800MB of RAM.
 * @param frameCount   Number of frames to extract (default 12)
 * @returns Array of ExtractedFrame objects with URL and timestamp
 */
export async function extractAndUploadFrames(
  videoSource: string,
  frameCount = 12,
): Promise<ExtractedFrame[]> {
  // Determine if videoSource is a local file or a URL
  const isLocalFile = !videoSource.startsWith("http://") && !videoSource.startsWith("https://");

  if (isLocalFile) {
    // Use the local file directly — no download needed
    return extractFramesFromLocalFile(videoSource, frameCount);
  }

  // For URL sources: stream-download to a temp file, then extract frames.
  // Use /var/tmp (backed by main disk, 16GB+) instead of /tmp (tmpfs, only 459MB)
  // so large video files don't hit ENOSPC.
  const tmpBase = fs.existsSync("/var/tmp") ? "/var/tmp" : os.tmpdir();
  const tmpDir = fs.mkdtempSync(path.join(tmpBase, "squash-frames-"));
  const videoPath = path.join(tmpDir, "video.mp4");
  try {
    console.log(`[frames] Streaming download from ${videoSource}`);
    await downloadVideoStreaming(videoSource, videoPath);
    return await extractFramesFromLocalFile(videoPath, frameCount);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Internal: extract frames from a local video file and upload to S3.
 *
 * To avoid selecting frames that fall during game breaks (between games,
 * between points, towelling-off, etc.), we split the video into `frameCount`
 * equal segments and within each segment extract CANDIDATES_PER_SEGMENT frames
 * at evenly-spaced sub-positions. We then pick the candidate with the largest
 * JPEG file size — a reliable proxy for motion activity, since JPEG compression
 * is less effective on high-motion frames (blurry players, fast movement) than
 * on static scenes (players standing still during a break).
 */
const CANDIDATES_PER_SEGMENT = 3; // how many candidate timestamps to try per segment

async function extractFramesFromLocalFile(
  videoPath: string,
  frameCount: number,
): Promise<ExtractedFrame[]> {
  const tmpBase = fs.existsSync("/var/tmp") ? "/var/tmp" : os.tmpdir();
  const tmpDir = fs.mkdtempSync(path.join(tmpBase, "squash-frames-"));
  try {
    const duration = await getVideoDuration(videoPath);
    console.log(`[frames] Video duration: ${duration.toFixed(1)}s`);
    if (duration <= 0) {
      throw new Error("Could not determine video duration");
    }

    // 1 frame every 6 seconds, capped at 60 — covers the full match well.
    // ffmpeg is extracted SEQUENTIALLY (one at a time) to avoid disk I/O
    // contention when multiple processes seek the same large video file.
    const FRAME_INTERVAL_SEC = 8;
    const MAX_FRAMES = 40;
    const actualCount = Math.min(MAX_FRAMES, Math.max(frameCount, Math.ceil(duration / FRAME_INTERVAL_SEC)));
    const interval = duration / actualCount;
    const timestamps = Array.from(
      { length: actualCount },
      (_, i) => interval * (i + 0.5),
    );

    // Sequential frame extraction — reliable on all server sizes
    const framePaths: (string | null)[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const framePath = path.join(tmpDir, `frame-${i}.jpg`);
      console.log(`[frames] Extracting frame ${i + 1}/${timestamps.length} at ${ts.toFixed(1)}s`);
      await extractFrame(videoPath, ts, framePath);
      if (fs.existsSync(framePath)) framePaths.push(framePath);
      else { console.warn(`[frames] Frame ${i + 1} not extracted, skipping`); framePaths.push(null); }
    }

    // Upload all extracted frames to S3 in parallel (8 at a time)
    const UPLOAD_CONCURRENCY = 8;
    const frameResults: ExtractedFrame[] = [];
    const validFrames = framePaths
      .map((p, i) => ({ path: p, ts: timestamps[i], idx: i }))
      .filter(f => f.path !== null);

    for (let i = 0; i < validFrames.length; i += UPLOAD_CONCURRENCY) {
      const batch = validFrames.slice(i, i + UPLOAD_CONCURRENCY);
      const results = await Promise.all(batch.map(async ({ path: framePath, ts, idx }) => {
        const frameBuffer = fs.readFileSync(framePath!);
        const base64 = frameBuffer.toString("base64");
        const uploadKey = `frames/${Date.now()}-frame-${idx}.jpg`;
        const { url } = await storagePut(uploadKey, frameBuffer, "image/jpeg");
        return { index: idx, url, base64, timestampSec: ts } as ExtractedFrame;
      }));
      frameResults.push(...results);
    }

    frameResults.sort((a, b) => a.index - b.index);
    console.log(`[frames] Extracted and uploaded ${frameResults.length} frames`);
    return frameResults;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
