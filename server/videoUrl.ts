/**
 * Video URL ingestion utility.
 *
 * Supports three external video sources:
 *  - YouTube  (via yt-dlp)
 *  - Google Drive  (direct download URL rewrite)
 *  - Google Photos  (direct download URL rewrite)
 *
 * Each source is detected by URL pattern, then downloaded to a temp file
 * which the caller is responsible for deleting.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type VideoSource = "youtube" | "google_drive" | "google_photos" | "direct";

export interface DownloadedVideo {
  /** Absolute path to the downloaded temp file */
  filePath: string;
  /** Detected MIME type (always video/mp4) */
  mimeType: string;
  /** Detected source type */
  source: VideoSource;
  /** Suggested filename for storage */
  filename: string;
}

// ─── URL detection ────────────────────────────────────────────────────────────

export function detectVideoSource(url: string): VideoSource {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
      return "youtube";
    }
    if (host === "drive.google.com") {
      return "google_drive";
    }
    if (host === "photos.google.com" || host === "lh3.googleusercontent.com") {
      return "google_photos";
    }
  } catch {
    // invalid URL — will fail later
  }
  return "direct";
}

export function isExternalVideoUrl(url: string): boolean {
  const source = detectVideoSource(url);
  return source !== "direct";
}

/**
 * Validate that a URL looks like a supported video source.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateVideoUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return "URL must start with http:// or https://";
    }
  } catch {
    return "Invalid URL format";
  }
  const source = detectVideoSource(url);
  if (source === "youtube") return null;
  if (source === "google_drive") {
    // Must be a /file/d/{id}/view or /open?id={id} link
    const u = new URL(url);
    const hasFileId = u.pathname.includes("/file/d/") || u.searchParams.has("id");
    if (!hasFileId) {
      return "Google Drive link must be a shared file link (e.g. drive.google.com/file/d/…/view)";
    }
    return null;
  }
  if (source === "google_photos") {
    return null;
  }
  return "Unsupported URL. Please provide a YouTube, Google Drive, or Google Photos link.";
}

// ─── Google Drive URL rewriting ───────────────────────────────────────────────

/**
 * Convert a Google Drive share URL to a direct download URL.
 *
 * Supported input formats:
 *   https://drive.google.com/file/d/{fileId}/view?usp=sharing
 *   https://drive.google.com/open?id={fileId}
 *   https://drive.google.com/uc?id={fileId}
 */
export function buildGoogleDriveDownloadUrl(shareUrl: string): string {
  const u = new URL(shareUrl);
  let fileId: string | null = null;

  // Format: /file/d/{fileId}/view
  const match = u.pathname.match(/\/file\/d\/([^/]+)/);
  if (match) {
    fileId = match[1];
  } else {
    // Format: ?id={fileId}
    fileId = u.searchParams.get("id");
  }

  if (!fileId) {
    throw new Error("Could not extract file ID from Google Drive URL");
  }

  // Use the export/download endpoint that bypasses the preview page
  return `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
}

// ─── Google Photos URL rewriting ─────────────────────────────────────────────

/**
 * Convert a Google Photos share URL to a direct video download URL.
 *
 * Google Photos URLs ending in lh3.googleusercontent.com can be suffixed
 * with =dv to request the original video file.
 *
 * For photos.google.com share links, we attempt a direct download.
 * Note: photos.google.com share links require the user to have made the
 * album/photo publicly accessible ("Anyone with the link can view").
 */
export function buildGooglePhotosDownloadUrl(shareUrl: string): string {
  const u = new URL(shareUrl);
  // lh3.googleusercontent.com direct media URLs
  if (u.hostname === "lh3.googleusercontent.com") {
    // Remove any existing size/format suffix and append =dv for original video
    const base = shareUrl.replace(/=[a-z0-9-]+$/, "");
    return `${base}=dv`;
  }
  // photos.google.com share links — return as-is; yt-dlp handles these
  return shareUrl;
}

// ─── Downloaders ─────────────────────────────────────────────────────────────

/**
 * Download a video from a direct HTTP URL (Google Drive / Google Photos).
 * Follows redirects (including Google's confirm redirect for large files).
 */
async function downloadDirect(url: string, destPath: string): Promise<void> {
  // Use curl for robust redirect following and cookie handling
  // (Google Drive requires a confirm cookie for large files)
  const { stderr } = await execFileAsync("curl", [
    "-L",                    // follow redirects
    "--max-redirs", "10",
    "-A", "Mozilla/5.0",     // user-agent to avoid bot blocks
    "--cookie", "download_warning=1", // bypass Google Drive virus scan warning
    "-o", destPath,
    url,
  ], { maxBuffer: 10 * 1024 * 1024 });

  if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) {
    throw new Error(`Download produced an empty or missing file. ${stderr}`);
  }
}

/**
 * Download a YouTube video using yt-dlp.
 * Downloads the best available mp4 up to 1080p.
 */
async function downloadYouTube(url: string, destPath: string): Promise<void> {
  // yt-dlp format: best mp4 up to 1080p, merge into single file
  const { stderr } = await execFileAsync("yt-dlp", [
    "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "-o", destPath,
    url,
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000 }); // 5 min timeout

  if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) {
    throw new Error(`yt-dlp failed to download video. ${stderr}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Download a video from an external URL to a temp file.
 *
 * @param url  YouTube, Google Drive, or Google Photos URL
 * @returns    DownloadedVideo with the temp file path and metadata
 * @throws     Error if the URL is unsupported or download fails
 */
export async function downloadVideoFromUrl(url: string): Promise<DownloadedVideo> {
  const source = detectVideoSource(url);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "squash-url-"));
  const destPath = path.join(tmpDir, "video.mp4");

  try {
    switch (source) {
      case "youtube":
        await downloadYouTube(url, destPath);
        break;

      case "google_drive": {
        const downloadUrl = buildGoogleDriveDownloadUrl(url);
        await downloadDirect(downloadUrl, destPath);
        break;
      }

      case "google_photos": {
        const downloadUrl = buildGooglePhotosDownloadUrl(url);
        if (new URL(url).hostname === "photos.google.com") {
          // photos.google.com share links — use yt-dlp which handles these
          await downloadYouTube(downloadUrl, destPath);
        } else {
          await downloadDirect(downloadUrl, destPath);
        }
        break;
      }

      default:
        throw new Error(`Unsupported video source: ${source}`);
    }

    return {
      filePath: destPath,
      mimeType: "video/mp4",
      source,
      filename: `video-${source}-${Date.now()}.mp4`,
    };
  } catch (err) {
    // Clean up temp dir on failure
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}
