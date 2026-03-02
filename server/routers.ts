import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";
import { extractAndUploadFrames, formatTimestamp, type ExtractedFrame } from "./videoFrames";

/**
 * Analyze a squash game video using AI vision
 */
export async function analyzeSquashVideoPublic(videoUrl: string, playerName?: string, playerDescription?: string) {
  try {
    // Extract evenly-spaced frames from the full video so the AI sees the
    // entire match rather than just the first few seconds.
    console.log("[analysis] Extracting frames from video:", videoUrl);
    const frames: ExtractedFrame[] = await extractAndUploadFrames(videoUrl, 12);

    if (frames.length === 0) {
      throw new Error("No frames could be extracted from the video");
    }

    console.log(`[analysis] Sending ${frames.length} frames to AI for analysis`);

    // Build the image content parts — one per extracted frame, labelled with
    // a 1-based frame number so the AI can reference them in its response.
    const imageContentParts = frames.map((frame, i) => ([
      {
        type: "text" as const,
        text: `Frame ${i + 1} of ${frames.length} (at ${formatTimestamp(frame.timestampSec)} in the video):`,
      },
      {
        type: "image_url" as const,
        image_url: { url: frame.url, detail: "auto" as const },
      },
    ])).flat();

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an expert squash coach analyzing game footage. You are given ${frames.length} frames extracted evenly across the full video duration, so you have visibility into the entire match.

Provide detailed, actionable feedback on:
1. Technique (racket preparation, swing mechanics, follow-through)
2. Positioning (T-position recovery, court coverage)
3. Shot Selection (when to use drops, drives, lobs, etc.)
4. Movement (footwork patterns, efficiency, explosiveness)

${playerName ? `Focus your analysis specifically on the player: ${playerName}${playerDescription ? ` (${playerDescription})` : ''}. Ignore other players in the video.` : 'Analyze the primary player visible in the footage.'}

For each suggestion, categorize it as:
- "success" for things done well
- "warning" for areas that need improvement
- "error" for critical issues that significantly impact performance

IMPORTANT: For each suggestion, you MUST reference the specific frame numbers that best illustrate the behavior:
- "frame_index": the 1-based frame number where the behavior STARTS or is first visible
- "end_frame_index": the 1-based frame number where the behavior ENDS or is last visible (can be the same as frame_index if it is a single moment, or a later frame if it spans multiple frames)

Choose frames that together form a meaningful clip showing the issue or positive behavior.

Return your analysis as a JSON object with this structure:
{"suggestions": [{"category": "technique|positioning|shot-selection|movement", "title": "string", "description": "string", "severity": "success|warning|error", "frame_index": <1-based start frame>, "end_frame_index": <1-based end frame>}]}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text: `Analyze these ${frames.length} frames from a squash game video and provide detailed coaching feedback. These frames are evenly distributed across the full video so they represent the complete match. For each suggestion, reference the specific frame number that best illustrates the behavior.`,
            },
            ...imageContentParts,
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content as string;
    const analysisData = JSON.parse(content);

    // Attach the actual frame URL and timestamp to each suggestion based on
    // the frame_index the AI returned (1-based). Fall back to frame 1 if missing.
    const suggestions = (analysisData.suggestions || []).map((s: {
      category: string;
      title: string;
      description: string;
      severity: string;
      frame_index?: number;
      end_frame_index?: number;
    }) => {
      const startIdx = Math.max(0, Math.min((s.frame_index ?? 1) - 1, frames.length - 1));
      // end_frame_index defaults to start + 1 frame (or same frame if at the end)
      const rawEndIdx = s.end_frame_index != null ? s.end_frame_index - 1 : startIdx + 1;
      const endIdx = Math.max(startIdx, Math.min(rawEndIdx, frames.length - 1));
      const startFrame = frames[startIdx];
      const endFrame = frames[endIdx];
      return {
        category: s.category,
        title: s.title,
        description: s.description,
        severity: s.severity,
        frameUrl: startFrame?.url ?? null,
        frameTimestamp: startFrame ? formatTimestamp(startFrame.timestampSec) : null,
        frameTimestampSec: startFrame?.timestampSec ?? null,
        endFrameTimestamp: endFrame ? formatTimestamp(endFrame.timestampSec) : null,
        endFrameTimestampSec: endFrame?.timestampSec ?? null,
      };
    });

    return { suggestions };
  } catch (error) {
    console.error("Video analysis failed:", error);
    throw new Error("Failed to analyze video");
  }
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  videos: router({
    /**
     * List all video analyses (public for now, no auth required)
     */
    list: publicProcedure.query(async () => {
      return db.getUserVideoAnalyses();
    }),

    /**
     * Get a single video analysis by ID
     */
    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getVideoAnalysis(input.id);
      }),

    /**
     * Upload a video and create analysis record
     */
    upload: publicProcedure
      .input(
        z.object({
          title: z.string().min(1).max(255),
          playerName: z.string().optional(),
          playerDescription: z.string().optional(),
          videoBase64: z.string(),
          mimeType: z.string().default("video/mp4"),
        })
      )
      .mutation(async ({ input }) => {
        // Convert base64 to buffer
        const videoBuffer = Buffer.from(input.videoBase64, "base64");

        // Generate unique filename
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(7);
        const fileKey = `videos/${timestamp}-${randomSuffix}.mp4`;

        // Upload to S3
        const { url: videoUrl } = await storagePut(
          fileKey,
          videoBuffer,
          input.mimeType
        );

        // Create database record
        const videoId = await db.createVideoAnalysis({
          title: input.title,
          playerName: input.playerName,
          playerDescription: input.playerDescription,
          videoUrl,
          status: "pending",
        });

        // Start analysis asynchronously (don't await)
        analyzeSquashVideoPublic(videoUrl, input.playerName, input.playerDescription)
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

        return { id: videoId, videoUrl };
      }),

    /**
     * Re-run AI analysis on an existing uploaded video
     */
    reanalyze: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        // Fetch the existing record to get the videoUrl and player info
        const existing = await db.getVideoAnalysis(input.id);
        if (!existing) {
          throw new Error("Video not found");
        }

        // Reset status to analyzing and clear old results
        await db.updateVideoAnalysis(input.id, {
          status: "analyzing",
          analysisResults: null,
          errorMessage: null,
        });

        // Re-run analysis asynchronously
        analyzeSquashVideoPublic(existing.videoUrl, existing.playerName ?? undefined, existing.playerDescription ?? undefined)
          .then(async (results: { suggestions: unknown[] }) => {
            await db.updateVideoAnalysis(input.id, {
              status: "complete",
              analysisResults: results,
            });
          })
          .catch(async (error: Error) => {
            await db.updateVideoAnalysis(input.id, {
              status: "failed",
              errorMessage: error.message,
            });
          });

        return { success: true, status: "analyzing" };
      }),

    /**
     * Delete a video analysis
     */
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteVideoAnalysis(input.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
