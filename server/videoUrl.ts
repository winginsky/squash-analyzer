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

/**
 * A clean environment for spawning Python-based tools (yt-dlp, curl).
 * Strips PYTHONHOME and PYTHONPATH which the Manus sandbox runtime sets to
 * Python 3.13 paths. When inherited by child processes, these cause the
 * "SRE module mismatch" AssertionError because Python 3.11 (the system
 * interpreter used by yt-dlp's shebang) tries to load Python 3.13's
 * C extension modules.
 */
const cleanEnv = ((): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  delete env.NUITKA_PYTHONPATH;
  return env;
})();

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
    if (host === "photos.google.com" || host === "lh3.googleusercontent.com" || host === "photos.app.goo.gl" || host === "goo.gl") {
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
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

  // Step 1: Fetch the URL — Google Drive may return a virus-scan warning HTML page
  // for large files (>25 MB) instead of the video directly.
  const { stderr } = await execFileAsync("curl", [
    "-L", "--max-redirs", "10",
    "-A", UA,
    "--cookie", "download_warning=1",
    "-o", destPath,
    url,
  ], { maxBuffer: 10 * 1024 * 1024, timeout: 30 * 60 * 1000, env: cleanEnv }); // 30 min for large files

  if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) {
    throw new Error(`Download produced an empty or missing file. ${stderr}`);
  }

  // Step 2: Check if Google returned an HTML page
  const fd = fs.openSync(destPath, "r");
  const header = Buffer.alloc(512);
  fs.readSync(fd, header, 0, 512, 0);
  fs.closeSync(fd);
  const headerStr = header.toString("utf8", 0, 512);
  const headerLower = headerStr.toLowerCase();

  if (!headerLower.startsWith("<!doctype html") && !headerLower.startsWith("<html")) {
    // Not HTML — we got the video directly, done.
    return;
  }

  // Step 3: It's an HTML page. Read the full page to determine why.
  const htmlContent = fs.readFileSync(destPath, "utf8");
  fs.unlinkSync(destPath); // remove the HTML file

  // Case A: Virus scan warning page — extract the real download URL from the form
  // The form contains: action="https://drive.usercontent.google.com/download"
  // with hidden inputs: id, export, confirm, uuid
  const virusScanMatch = htmlContent.match(/Virus scan warning|can't scan this file/i);
  const uuidMatch = htmlContent.match(/name=["']uuid["']\s+value=["']([^"']+)["']/);
  const fileIdMatch = htmlContent.match(/name=["']id["']\s+value=["']([^"']+)["']/);

  if (virusScanMatch && uuidMatch && fileIdMatch) {
    // Build the confirmed download URL
    const uuid = uuidMatch[1];
    const fileId = fileIdMatch[1];
    const realUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t&uuid=${uuid}`;
    console.log(`[downloadDirect] Google Drive virus-scan bypass: downloading from ${realUrl}`);

    // Download the actual video
    const { stderr: stderr2 } = await execFileAsync("curl", [
      "-L", "--max-redirs", "5",
      "-A", UA,
      "-o", destPath,
      realUrl,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 30 * 60 * 1000, env: cleanEnv }); // 30 min for large files

    if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) {
      throw new Error(`Google Drive virus-scan bypass download failed. ${stderr2}`);
    }
    return;
  }

  // Case B: Sign-in / private file page
  if (htmlContent.toLowerCase().includes("accounts.google.com") ||
      htmlContent.toLowerCase().includes("sign in") ||
      htmlContent.toLowerCase().includes("signin")) {
    throw new Error(
      "GOOGLE_DRIVE_PRIVATE: This Google Drive file is not publicly accessible. " +
      "To fix: open the file in Google Drive → right-click → Share → change to \"Anyone with the link can view\", then try again."
    );
  }

  // Case C: Unknown HTML error page
  throw new Error(
    "GOOGLE_DRIVE_PRIVATE: Google Drive returned an unexpected page instead of the video. " +
    "Make sure the file is shared as \"Anyone with the link can view\" and try again."
  );
}

/**
 * Download a YouTube video using yt-dlp.
 * Downloads the best available mp4 up to 1080p.
 */
async function downloadYouTube(url: string, destPath: string): Promise<void> {
  // yt-dlp format: best mp4 up to 1080p, merge into single file
  // Use Node.js as the JS runtime (required for YouTube extraction)
  const nodePath = process.execPath.replace(/node$/, "node");
  let stderr = "";

  /**
   * Helper: check stderr/errMsg for YouTube bot-detection and throw a clear error.
   * yt-dlp sometimes exits with code 0 even on bot-detection errors, so we must
   * check stderr regardless of whether execFileAsync threw.
   */
  function checkForBotDetection(msg: string): void {
    if (
      msg.includes("Sign in to confirm") ||
      msg.includes("not a bot") ||
      msg.includes("cookies") ||
      msg.includes("authentication")
    ) {
      throw new Error(
        "YOUTUBE_BOT_DETECTION: YouTube requires authentication to download from this server. " +
        "Please upload the video to Google Drive and share it as \"Anyone with the link can view\", " +
        "then paste the Google Drive link instead."
      );
    }
  }

  try {
    const result = await execFileAsync("yt-dlp", [
      "--js-runtimes", `node:${nodePath}`,
      "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "-o", destPath,
      url,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000, env: cleanEnv }); // 5 min timeout
    stderr = result.stderr;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Detect YouTube bot/login detection error and provide a clear user-facing message
    checkForBotDetection(errMsg);
    throw new Error(`yt-dlp failed: ${errMsg}`);
  }

  // yt-dlp has a known bug where it exits with code 0 even on bot-detection errors.
  // Always check stderr for bot-detection messages, even when execFileAsync succeeded.
  checkForBotDetection(stderr);

  if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) {
    // File missing despite exit code 0 — check stderr for the real reason
    const reason = stderr.includes("ERROR:") ? stderr.split("ERROR:").pop()?.trim() ?? stderr : stderr;
    throw new Error(`yt-dlp failed to produce a video file. ${reason}`);
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
        // Google Photos share links (photos.google.com/share/... and photos.app.goo.gl)
        // cannot be downloaded server-side because the video URL is only available after
        // JavaScript executes in a browser. yt-dlp does not support these URLs.
        //
        // lh3.googleusercontent.com direct media URLs (with =dv suffix) do work.
        const urlHost = new URL(url).hostname;
        if (urlHost === "lh3.googleusercontent.com") {
          const downloadUrl = buildGooglePhotosDownloadUrl(url);
          await downloadDirect(downloadUrl, destPath);
        } else {
          // photos.google.com/share or photos.app.goo.gl — not downloadable server-side
          throw new Error(
            "GOOGLE_PHOTOS_UNSUPPORTED: Google Photos share links cannot be downloaded automatically. " +
            "To analyse this video, please: (1) open the video in Google Photos, " +
            "(2) tap the three-dot menu → Download, (3) upload the downloaded file directly, " +
            "or (4) upload the video to Google Drive and share a Drive link instead."
          );
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
