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
  /** Public S3 URL of the JPEG image */
  url: string;
  /** Timestamp in seconds within the video where this frame was taken */
  timestampSec: number;
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

  // For URL sources: stream-download to a temp file, then extract frames
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "squash-frames-"));
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
 */
async function extractFramesFromLocalFile(
  videoPath: string,
  frameCount: number,
): Promise<ExtractedFrame[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "squash-frames-"));
  try {
    const duration = await getVideoDuration(videoPath);
    console.log(`[frames] Video duration: ${duration.toFixed(1)}s`);
    if (duration <= 0) {
      throw new Error("Could not determine video duration");
    }

    // Place frames at evenly-spaced intervals, avoiding the very start/end.
    // e.g. for 12 frames in a 150s video: 6.25s, 18.75s, 31.25s, ...
    const interval = duration / frameCount;
    const timestamps = Array.from(
      { length: frameCount },
      (_, i) => interval * (i + 0.5),
    );

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const framePath = path.join(tmpDir, `frame-${i}.jpg`);
      console.log(`[frames] Extracting frame ${i + 1}/${frameCount} at ${ts.toFixed(1)}s`);
      await extractFrame(videoPath, ts, framePath);

      if (!fs.existsSync(framePath)) {
        console.warn(`[frames] Frame ${i + 1} not extracted, skipping`);
        continue;
      }

      const frameBuffer = fs.readFileSync(framePath);
      const uploadKey = `frames/${Date.now()}-frame-${i}.jpg`;
      const { url } = await storagePut(uploadKey, frameBuffer, "image/jpeg");
      frames.push({ index: i, url, timestampSec: ts });
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
