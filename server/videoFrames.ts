/**
 * Video frame extraction utility.
 *
 * Downloads a video from a URL, uses ffmpeg to extract evenly-spaced frames
 * across the full duration, uploads each frame to S3, and returns their URLs
 * along with the timestamp (in seconds) each frame was taken from.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { storagePut } from "./storage";

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
 * Download a video from a URL to a temp file.
 */
async function downloadVideo(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
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
 * Extract evenly-spaced frames from a video URL and upload them to S3.
 *
 * @param videoUrl   Public URL of the video (S3/CloudFront)
 * @param frameCount Number of frames to extract (default 12)
 * @returns Array of ExtractedFrame objects with URL and timestamp
 */
export async function extractAndUploadFrames(
  videoUrl: string,
  frameCount = 12,
): Promise<ExtractedFrame[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "squash-frames-"));
  const videoPath = path.join(tmpDir, "video.mp4");

  try {
    console.log(`[frames] Downloading video from ${videoUrl}`);
    await downloadVideo(videoUrl, videoPath);

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
