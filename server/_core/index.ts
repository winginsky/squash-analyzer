import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import multer from "multer";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter, analyzeSquashVideoPublic } from "../routers";
import { createContext } from "./context";
import { storagePut } from "../storage";
import * as db from "../db";

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

  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // ── Multipart video upload endpoint ──────────────────────────────────────
  // Uses multer memory storage so we can pipe the buffer directly to S3.
  // This avoids the tRPC JSON body size limit for large video files.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
  });

  app.post(
    "/api/upload-video",
    upload.single("video"),
    async (req: express.Request, res: express.Response) => {
      try {
        if (!req.file) {
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

        const mimeType = req.file.mimetype || "video/mp4";
        const ext = mimeType.split("/")[1] || "mp4";
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(7);
        const fileKey = `videos/${timestamp}-${randomSuffix}.${ext}`;

        // Upload buffer directly to S3
        const { url: videoUrl } = await storagePut(fileKey, req.file.buffer, mimeType);

        // Create database record
        const videoId = await db.createVideoAnalysis({
          title,
          playerName: playerName || undefined,
          playerDescription: playerDescription || undefined,
          videoUrl,
          status: "pending",
        });

        analyzeSquashVideoPublic(videoUrl, playerName, playerDescription)
          .then(async (results: { suggestions: unknown[] }) => {
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
          });

        res.json({ id: videoId, videoUrl });
      } catch (err) {
        console.error("[upload-video] error:", err);
        res.status(500).json({ error: "Upload failed", detail: String(err) });
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

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
