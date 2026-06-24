import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter, analyzeSquashVideoPublic } from "../routers";
import { createContext } from "./context";
import { storagePut, storagePutFile, getPresignedUploadUrl, createMultipartUpload, completeMultipartUpload, abortMultipartUpload } from "../storage";
import { sdk } from "./sdk";
import * as db from "../db";
import { downloadVideoFromUrl, validateVideoUrl, detectVideoSource } from "../videoUrl";
import {
  handleRegister,
  handleLogin,
  handleGoogleLogin,
  handleGoogleCallback,
  handleLogout,
  handleMe,
  authenticateRequest,
} from "./auth";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "200mb" }));
  app.use(express.urlencoded({ limit: "200mb", extended: true }));
  app.use(cookieParser());

  // ── Auth routes ──────────────────────────────────────────────────────────
  app.post("/api/auth/register", handleRegister);
  app.post("/api/auth/login", handleLogin);
  app.post("/api/auth/logout", handleLogout);
  app.get("/api/auth/me", handleMe);
  app.get("/api/auth/google", handleGoogleLogin);
  app.get("/api/auth/google/callback", handleGoogleCallback);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // ── In-memory analysis progress store (videoId → progress message) ──────────
  // Lightweight — no DB writes needed for transient progress updates.
  const analysisProgress = new Map<number, { step: string; pct: number }>();

  // ── Presigned S3 upload — browser uploads directly to S3, no nginx bottleneck ──
  app.post("/api/presign-upload", async (req, res) => {
    try {
      const { title, playerName, playerDescription, mimeType, fileExt } = req.body as {
        title?: string; playerName?: string; playerDescription?: string;
        mimeType?: string; fileExt?: string;
      };
      if (!title) { res.status(400).json({ error: "Title is required" }); return; }
      const mime = mimeType || "video/mp4";
      const ext = (fileExt || mime.split("/")[1] || "mp4").replace("quicktime", "mov");
      const key = `videos/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const { uploadUrl, publicUrl } = await getPresignedUploadUrl(key, mime);

      let uploadUserId: number | undefined;
      try { uploadUserId = (await sdk.authenticateRequest(req)).id; } catch { /* anon ok */ }

      const videoId = await db.createVideoAnalysis({
        title, playerName: playerName || undefined,
        playerDescription: playerDescription || undefined,
        videoUrl: publicUrl, userId: uploadUserId, status: "pending",
      });
      res.json({ videoId, uploadUrl, videoUrl: publicUrl });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Called by the browser after the S3 upload completes to kick off analysis
  app.post("/api/start-analysis", express.json(), async (req, res) => {
    try {
      const { videoId, videoUrl, playerName, playerDescription } = req.body as {
        videoId: number; videoUrl: string; playerName?: string; playerDescription?: string;
      };
      await db.updateVideoAnalysis(videoId, { status: "analyzing" });
      analysisProgress.set(videoId, { step: "Downloading video…", pct: 5 });
      res.json({ ok: true });

      (async () => {
        try {
          analysisProgress.set(videoId, { step: "Downloading video…", pct: 10 });
          // Monkey-patch progress into the analysis by hooking console output
          const origLog = console.log;
          let framesDone = 0, framesTotal = 0;
          console.log = (...args: unknown[]) => {
            origLog(...args);
            const msg = args.join(" ");
            const durMatch = msg.match(/Video duration:/);
            if (durMatch) analysisProgress.set(videoId, { step: "Extracting frames…", pct: 15 });
            const frameMatch = msg.match(/Extracting frame (\d+)\/(\d+)/);
            if (frameMatch) {
              framesDone = parseInt(frameMatch[1]);
              framesTotal = parseInt(frameMatch[2]);
              const pct = 15 + Math.round((framesDone / framesTotal) * 45);
              analysisProgress.set(videoId, { step: `Extracting frames… ${framesDone}/${framesTotal}`, pct });
            }
            if (msg.includes("Sending") && msg.includes("frames to AI")) {
              analysisProgress.set(videoId, { step: "AI analyzing footage…", pct: 65 });
            }
            if (msg.includes("AI returned")) {
              analysisProgress.set(videoId, { step: "Saving results…", pct: 95 });
            }
          };
          const results = await analyzeSquashVideoPublic(videoUrl, playerName, playerDescription);
          console.log = origLog;
          analysisProgress.set(videoId, { step: "Complete", pct: 100 });
          await db.updateVideoAnalysis(videoId, { status: "complete", analysisResults: results });
        } catch (error) {
          analysisProgress.delete(videoId);
          await db.updateVideoAnalysis(videoId, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Analysis progress polling endpoint
  app.get("/api/analysis-progress/:videoId", (req, res) => {
    const videoId = parseInt(req.params.videoId);
    const progress = analysisProgress.get(videoId);
    res.json(progress ?? { step: "Analyzing…", pct: 50 });
  });

  // ── Multipart S3 upload — splits large videos into parallel chunks ──────────
  // Step 1: browser calls this to get per-part presigned URLs
  app.post("/api/presign-multipart", async (req, res) => {
    try {
      const { title, playerName, playerDescription, mimeType, fileExt, fileSize } = req.body as {
        title?: string; playerName?: string; playerDescription?: string;
        mimeType?: string; fileExt?: string; fileSize?: number;
      };
      if (!title) { res.status(400).json({ error: "Title is required" }); return; }
      const mime = mimeType || "video/mp4";
      const ext = (fileExt || mime.split("/")[1] || "mp4").replace("quicktime", "mp4");
      const key = `videos/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

      // Choose part count so each part is ~10 MB (minimum 5 MB required by S3)
      const size = fileSize || 100 * 1024 * 1024;
      const partSize = 10 * 1024 * 1024; // 10 MB per part
      const partCount = Math.max(1, Math.ceil(size / partSize));

      const { uploadId, publicUrl, partUrls } = await createMultipartUpload(key, mime, partCount);

      let uploadUserId: number | undefined;
      try { uploadUserId = (await sdk.authenticateRequest(req)).id; } catch { /* anon ok */ }

      const videoId = await db.createVideoAnalysis({
        title, playerName: playerName || undefined,
        playerDescription: playerDescription || undefined,
        videoUrl: publicUrl, userId: uploadUserId, status: "pending",
      });
      res.json({ videoId, uploadId, key, videoUrl: publicUrl, partUrls, partSize });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Step 2: browser calls this after all parts are uploaded
  app.post("/api/complete-multipart", async (req, res) => {
    try {
      const { key, uploadId, parts } = req.body as {
        key: string;
        uploadId: string;
        parts: { PartNumber: number; ETag: string }[];
      };
      await completeMultipartUpload(key, uploadId, parts);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Abort multipart on error
  app.post("/api/abort-multipart", async (req, res) => {
    try {
      const { key, uploadId } = req.body as { key: string; uploadId: string };
      await abortMultipartUpload(key, uploadId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Multipart video upload endpoint ──────────────────────────────────────
  // Uses multer DISK storage so large video files are streamed to a temp
  // directory rather than buffered entirely in RAM. This avoids OOM errors
  // for videos that are hundreds of MB.
  // Use /var/tmp (backed by main disk, 16 GB+) instead of /tmp (tmpfs, 459 MB)
  // so large video uploads don't hit ENOSPC before they reach S3.
  const uploadTmpBase = fs.existsSync("/var/tmp") ? "/var/tmp" : os.tmpdir();
  const uploadTmpDir = fs.mkdtempSync(path.join(uploadTmpBase, "squash-upload-"));
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadTmpDir),
      filename: (_req, file, cb) => {
        const ext = (file.mimetype || "video/mp4").split("/")[1] || "mp4";
        cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max
  });

  app.post(
    "/api/upload-video",
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      upload.single("video")(req, res, (err) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            res.status(413).json({ error: "File too large. Maximum video size is 2 GB." });
          } else {
            res.status(400).json({ error: "Upload error", detail: String(err) });
          }
          return;
        }
        next();
      });
    },
    async (req: express.Request, res: express.Response) => {
      const tmpFilePath = (req.file as Express.Multer.File & { path: string })?.path;
      try {
        if (!req.file || !tmpFilePath) {
          res.status(400).json({ error: "No video file provided" });
          return;
        }

        const { title, playerName, playerDescription } = req.body as {
          title?: string;
          playerName?: string;
          playerDescription?: string;
        };

        if (!title) {
          res.status(400).json({ error: "Title is required" });
          return;
        }

        // Authenticate the uploader so the video is scoped to their account
        let uploadUserId: number | undefined;
        try {
          const authUser = await sdk.authenticateRequest(req);
          uploadUserId = authUser.id;
        } catch {
          // Allow anonymous uploads for backwards compat, but log the warning
          console.warn("[upload-video] No authenticated user — video will be unowned");
        }

        const mimeType = req.file.mimetype || "video/mp4";
        const ext = (mimeType.split("/")[1] || "mp4").replace("quicktime", "mov");
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(7);
        const fileKey = `videos/${timestamp}-${randomSuffix}.${ext}`;

        // Upload directly from disk to S3 — avoids loading the whole file into RAM
        const { url: videoUrl } = await storagePutFile(fileKey, tmpFilePath, mimeType);

        // Create database record
        const videoId = await db.createVideoAnalysis({
          title,
          playerName: playerName || undefined,
          playerDescription: playerDescription || undefined,
          videoUrl,
          userId: uploadUserId,
          status: "pending",
        });

        // Respond immediately so the browser isn't waiting
        res.json({ id: videoId, videoUrl });
        // Run analysis asynchronously after responding.
        // Pass the LOCAL temp file path so extractAndUploadFrames does not
        // re-download the video from S3 (avoids OOM for large files).
        const localPath = tmpFilePath;
        analyzeSquashVideoPublic(localPath, playerName, playerDescription)
          .then(async (results) => {
            await db.updateVideoAnalysis(videoId, {
              status: "complete",
              analysisResults: results,
            });
          })
          .catch(async (error: Error) => {
            await db.updateVideoAnalysis(videoId, {
              status: "failed",
              errorMessage: error.message,
            });
          })
          .finally(() => {
            // Clean up temp file only after analysis completes
            if (localPath) {
              try { fs.unlinkSync(localPath); } catch { /* ignore */ }
            }
          });
      } catch (err) {
        console.error("[upload-video] error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Upload failed", detail: String(err) });
        }
        // Clean up temp file on error (analysis never started)
        if (tmpFilePath) {
          try { fs.unlinkSync(tmpFilePath); } catch { /* ignore */ }
        }
      }
    },
  );
  // ── URL-based video ingestion endpointt ─────────────────────────────────────
  // Accepts a YouTube, Google Drive, or Google Photos URL, downloads the video
  // server-side, uploads it to S3, and kicks off analysis — same pipeline as
  // the file upload endpoint but without multipart form data.
  app.post(
    "/api/upload-video-url",
    async (req: express.Request, res: express.Response) => {
      let downloadedFilePath: string | null = null;
      try {
        const { url, title, playerName, playerDescription } = req.body as {
          url?: string;
          title?: string;
          playerName?: string;
          playerDescription?: string;
        };
        if (!url) {
          res.status(400).json({ error: "url is required" });
          return;
        }
        if (!title) {
          res.status(400).json({ error: "title is required" });
          return;
        }
        const validationError = validateVideoUrl(url);
        if (validationError) {
          res.status(400).json({ error: validationError });
          return;
        }
        // Authenticate the uploader (optional — allow anonymous for testing)
        let uploadUserId: number | undefined;
        try {
          const authUser = await sdk.authenticateRequest(req);
          uploadUserId = authUser.id;
        } catch {
          console.warn("[upload-video-url] No authenticated user — video will be unowned");
        }
        const source = detectVideoSource(url);
        // Create DB record immediately with "downloading" status so the UI can
        // show a pending card right away without waiting for the large download.
        const videoId = await db.createVideoAnalysis({
          title,
          playerName: playerName || undefined,
          playerDescription: playerDescription || undefined,
          videoUrl: "", // will be updated after download completes
          userId: uploadUserId,
          status: "downloading",
        });
        // Respond to the browser immediately — no more timeout risk.
        res.json({ id: videoId, source });
        // Run the entire download → S3 upload → analysis pipeline in the background.
        (async () => {
          let bgFilePath: string | null = null;
          try {
            console.log(`[upload-video-url] [${videoId}] Downloading from ${source}: ${url}`);
            const downloaded = await downloadVideoFromUrl(url);
            bgFilePath = downloaded.filePath;
            console.log(`[upload-video-url] [${videoId}] Downloaded to ${downloaded.filePath}`);
            // Upload to S3 (streaming — does not load file into RAM)
            const fileKey = `videos/${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`;
            const { url: videoUrl } = await storagePutFile(fileKey, downloaded.filePath, "video/mp4");
            // Update record with real video URL and move to analyzing
            await db.updateVideoAnalysis(videoId, { videoUrl, status: "analyzing" });
            console.log(`[upload-video-url] [${videoId}] Uploaded to S3, starting analysis`);
            // Run AI analysis — pass the LOCAL file path so extractAndUploadFrames
            // does NOT re-download the 800MB file from S3 (which would OOM the server).
            // The local file is cleaned up in the finally block after analysis completes.
            const results = await analyzeSquashVideoPublic(downloaded.filePath, playerName, playerDescription);
            await db.updateVideoAnalysis(videoId, { status: "complete", analysisResults: results });
            console.log(`[upload-video-url] [${videoId}] Analysis complete`);
          } catch (bgErr) {
            console.error(`[upload-video-url] [${videoId}] Background error:`, bgErr);
            const msg = bgErr instanceof Error ? bgErr.message : String(bgErr);
            await db.updateVideoAnalysis(videoId, { status: "failed", errorMessage: msg }).catch(() => {});
          } finally {
            if (bgFilePath) {
              try { fs.unlinkSync(bgFilePath); } catch { /* ignore */ }
              try { fs.rmdirSync(path.dirname(bgFilePath)); } catch { /* ignore */ }
            }
          }
        })();
      } catch (err) {
        console.error("[upload-video-url] error:", err);
        if (!res.headersSent) {
          const msg = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: "Failed to process video URL", detail: msg });
        }
      }
    },
  );

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  /**
   * Internal admin endpoint: trigger (or re-trigger) analysis for a video by ID.
   * Protected by JWT_SECRET in the x-internal-secret header.
   * Only intended to be called from localhost / SSH tunnel.
   */
  app.post("/api/internal/trigger-analysis", express.json(), async (req, res) => {
    const { ENV } = await import("./env.js");
    if (!ENV.jwtSecret || req.headers["x-internal-secret"] !== ENV.jwtSecret) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const videoId = Number(req.body?.videoId);
    if (!videoId) {
      res.status(400).json({ error: "videoId required" });
      return;
    }
    const video = await db.getVideoAnalysis(videoId);
    if (!video) {
      res.status(404).json({ error: "Video not found" });
      return;
    }
    // Reset status and kick off async analysis
    await db.updateVideoAnalysis(videoId, { status: "analyzing", analysisResults: null, errorMessage: null });
    res.json({ success: true, videoId, status: "analyzing" });

    // Run analysis in background
    analyzeSquashVideoPublic(
      video.videoUrl,
      video.playerName ?? undefined,
      video.playerDescription ?? undefined,
      (video.coachNotes as Parameters<typeof analyzeSquashVideoPublic>[3]) ?? null,
    )
      .then((results) => db.updateVideoAnalysis(videoId, { status: "complete", analysisResults: results }))
      .catch((err: Error) => {
        console.error(`[internal] Analysis failed for video ${videoId}:`, err.message);
        db.updateVideoAnalysis(videoId, { status: "failed", errorMessage: err.message });
      });
  });

  const preferredPort = parseInt(process.env.PORT || "3000");

  // Always bind to the preferred port. If it is occupied (e.g. by a stale
  // process from a previous run), wait briefly and retry rather than drifting
  // to a different port — the frontend derives the API URL by replacing 8081
  // with 3000 in the hostname, so any port drift breaks all API calls.
  await new Promise<void>((resolve, reject) => {
    const tryListen = (attemptsLeft: number) => {
      server.listen(preferredPort, () => {
        console.log(`[api] server listening on port ${preferredPort}`);
        // Reset any zombie jobs left over from a previous crash/restart
        db.resetZombieJobs().then((count) => {
          if (count > 0) {
            console.log(`[api] Reset ${count} zombie job(s) stuck in analyzing/pending state`);
          }
        }).catch((err) => {
          console.warn("[api] Failed to reset zombie jobs:", err);
        });
        resolve();
      });
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
          console.warn(`[api] Port ${preferredPort} busy, retrying in 2s… (${attemptsLeft} attempts left)`);
          server.removeAllListeners("error");
          setTimeout(() => tryListen(attemptsLeft - 1), 2000);
        } else {
          reject(err);
        }
      });
    };
    tryListen(10); // retry up to 10 times (20 seconds total)
  });
}

startServer().catch(console.error);
