import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";

/**
 * Analyze a squash game video using AI vision
 */
async function analyzeSquashVideo(videoUrl: string) {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an expert squash coach analyzing game footage. Provide detailed, actionable feedback on:
1. Technique (racket preparation, swing mechanics, follow-through)
2. Positioning (T-position recovery, court coverage)
3. Shot Selection (when to use drops, drives, lobs, etc.)
4. Movement (footwork patterns, efficiency, explosiveness)

For each suggestion, categorize it as:
- "success" for things done well
- "warning" for areas that need improvement
- "error" for critical issues that significantly impact performance

Return your analysis as a JSON array of suggestions with this structure:
{"suggestions": [{"category": "technique|positioning|shot-selection|movement", "title": "string", "description": "string", "severity": "success|warning|error"}]}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this squash game video and provide detailed coaching feedback.",
            },
            {
              type: "file_url",
              file_url: {
                url: videoUrl,
                mime_type: "video/mp4",
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content as string;
    const analysisData = JSON.parse(content);

    return {
      suggestions: analysisData.suggestions || [],
    };
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
          videoUrl,
          status: "pending",
        });

        // Start analysis asynchronously (don't await)
        analyzeSquashVideo(videoUrl)
          .then(async (results) => {
            await db.updateVideoAnalysis(videoId, {
              status: "complete",
              analysisResults: results,
            });
          })
          .catch(async (error) => {
            await db.updateVideoAnalysis(videoId, {
              status: "failed",
              errorMessage: error.message,
            });
          });

        return { id: videoId, videoUrl };
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
