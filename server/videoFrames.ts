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
  // Use a disk-backed directory to avoid overflowing /tmp (which is often a
  // small tmpfs — e.g. 459 MB — that can't hold a 600+ MB video file).
  // Prefer VIDEO_TMP_DIR env var, then /var/tmp (disk-backed on Linux),
  // then fall back to os.tmpdir() for local dev.
  const tmpBase = process.env.VIDEO_TMP_DIR
    || (fs.existsSync("/var/tmp") ? "/var/tmp" : os.tmpdir());
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
  const tmpBase = process.env.VIDEO_TMP_DIR
    || (fs.existsSync("/var/tmp") ? "/var/tmp" : os.tmpdir());
  const tmpDir = fs.mkdtempSync(path.join(tmpBase, "squash-frames-"));
  try {
    const duration = await getVideoDuration(videoPath);
    console.log(`[frames] Video duration: ${duration.toFixed(1)}s`);
    if (duration <= 0) {
      throw new Error("Could not determine video duration");
    }

    // Divide video into frameCount equal segments.
    // Within each segment, sample CANDIDATES_PER_SEGMENT timestamps and pick
    // the one whose extracted JPEG is largest (= most motion = most likely
    // to be an active rally rather than a game break).
    const segmentDuration = duration / frameCount;

    const frames: ExtractedFrame[] = [];

    for (let seg = 0; seg < frameCount; seg++) {
      const segStart = seg * segmentDuration;
      const segEnd = segStart + segmentDuration;

      // Candidate timestamps: evenly spaced within this segment
      const candidates = Array.from(
        { length: CANDIDATES_PER_SEGMENT },
        (_, k) => segStart + segmentDuration * ((k + 1) / (CANDIDATES_PER_SEGMENT + 1)),
      );

      let bestBuffer: Buffer | null = null;
      let bestTs = candidates[0];

      for (let k = 0; k < candidates.length; k++) {
        const ts = candidates[k];
        const candidatePath = path.join(tmpDir, `seg-${seg}-cand-${k}.jpg`);
        try {
          await extractFrame(videoPath, ts, candidatePath);
          if (!fs.existsSync(candidatePath)) continue;
          const buf = fs.readFileSync(candidatePath);
          // Pick the largest JPEG (highest activity / motion)
          if (bestBuffer === null || buf.length > bestBuffer.length) {
            bestBuffer = buf;
            bestTs = ts;
          }
        } catch {
          // Skip failed extractions
        }
      }

      if (!bestBuffer) {
        console.warn(`[frames] Segment ${seg + 1}/${frameCount}: no frame extracted, skipping`);
        continue;
      }

      console.log(
        `[frames] Segment ${seg + 1}/${frameCount}: best frame at ${bestTs.toFixed(1)}s` +
        ` (${(bestBuffer.length / 1024).toFixed(0)}KB, window ${segStart.toFixed(0)}–${segEnd.toFixed(0)}s)`,
      );

      const uploadKey = `frames/${Date.now()}-frame-${seg}.jpg`;
      const { url } = await storagePut(uploadKey, bestBuffer, "image/jpeg");
      frames.push({ index: seg, url, timestampSec: bestTs, base64: bestBuffer.toString("base64") });
    }

    // Compute relative motion scores so the AI (and any callers) can tell
    // which frames are high-activity (score > 1.0) vs likely breaks (score < 0.7).
    // We decode base64 back to bytes just for the size — no pixel processing needed.
    if (frames.length > 0) {
      const sizes = frames.map((f) => (f.base64 ? Buffer.byteLength(f.base64, "base64") : 0));
      const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      if (avgSize > 0) {
        frames.forEach((f, i) => {
          f.motionScore = Math.round((sizes[i] / avgSize) * 100) / 100;
        });
      }
    }

    console.log(`[frames] Extracted and uploaded ${frames.length} frames`);
    return frames;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
