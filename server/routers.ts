import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";
import { extractAndUploadFrames, formatTimestamp, type ExtractedFrame } from "./videoFrames";

/**
 * Synthesize or update a player's persistent coaching profile from new session data.
 *
 * This is called after every successful analysis that includes meeting notes.
 * It asks the LLM to merge the new session insights into the player's existing
 * profile (if any), producing an updated markdown document that will be injected
 * into future analyses for this player.
 */
export async function synthesizePlayerProfile(
  playerName: string,
  meetingNotes: string,
  analysisResults: {
    strategyOverview?: {
      strengths?: string[];
      strategyUsed?: string[];
      opponentWeaknesses?: string[];
      strategicAdjustments?: string[];
    } | null;
    suggestions?: Array<{ title: string; description?: string; drill?: string | null }>;
  },
  existingProfile: string | null,
): Promise<string> {
  const suggestionsText = (analysisResults.suggestions ?? [])
    .map((s, i) => `${i + 1}. **${s.title}**: ${s.description ?? ""}${s.drill ? ` _(Drill: ${s.drill})_` : ""}`)
    .join("\n");

  const strategyText = analysisResults.strategyOverview
    ? [
        analysisResults.strategyOverview.strengths?.length
          ? `**Strengths**: ${analysisResults.strategyOverview.strengths.join("; ")}`
          : "",
        analysisResults.strategyOverview.strategicAdjustments?.length
          ? `**Adjustments needed**: ${analysisResults.strategyOverview.strategicAdjustments.join("; ")}`
          : "",
        analysisResults.strategyOverview.opponentWeaknesses?.length
          ? `**Opponent patterns to exploit**: ${analysisResults.strategyOverview.opponentWeaknesses.join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const prompt = `You are a squash coaching assistant. Your job is to maintain a structured, evolving coaching profile for a specific player.

${existingProfile
    ? `## Existing Coaching Profile for ${playerName}

The following profile was built from previous sessions. You must PRESERVE all still-relevant insights and MERGE the new session's findings into it.

${existingProfile}

---`
    : `No prior profile exists for ${playerName} — create one from scratch.`}

## New Session Data

### Coach Meeting Notes (real-time verbal commentary):
${meetingNotes.trim()}

### AI Video Analysis — Strategy Overview:
${strategyText || "(not available)"}

### AI Video Analysis — Top Improvement Areas:
${suggestionsText || "(not available)"}

---

## Your Task

Produce an updated, comprehensive coaching profile for **${playerName}** in Markdown.

The profile should be structured as follows (use exactly these headings):

# Coaching Profile: ${playerName}

## Technical Patterns (recurring across sessions)
- List recurring technical issues the coach has noted across sessions (e.g. backhand weakness, shot height)
- Mark items that have appeared in multiple sessions with ⚡ to signal high priority

## Strategic Tendencies
- Tactical patterns and court positioning habits
- Shot selection tendencies (both strengths and weaknesses)

## Key Coaching Themes (What the coach consistently emphasises)
- Direct quotes or paraphrases from the coach's meeting notes, across sessions
- These are the non-negotiable focal points the coach returns to repeatedly

## Opponent Exploitation (Patterns to target)
- Specific opponent weaknesses the coach has identified
- Cross-court vs straight shot strategies

## Active Drills (most recently prescribed)
- Drills from this session and any still-relevant drills from past sessions

## Progress Notes
- Brief session-by-session summary (newest first)
- Note what improved, what regressed, what's new

Keep the profile concise but comprehensive (under 600 words). Use bullet points. Focus on actionable coaching intelligence that will help an AI video analysis system produce better, more personalised feedback in future sessions.`;

  const response = await invokeLLM({
    messages: [
      { role: "user", content: prompt },
    ],
    maxTokens: 1500,
  });

  const content = response.choices[0].message.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

/**
 * Analyze a squash game video using AI vision
 */
export async function analyzeSquashVideoPublic(
  videoUrl: string,
  playerName?: string,
  playerDescription?: string,
  coachNotes?: {
    coachName?: string;
    coachComment?: string;
    strategyOverview?: {
      strengths?: string[];
      strategyUsed?: string[];
      opponentWeaknesses?: string[];
      strategicAdjustments?: string[];
    };
    suggestions?: { title: string; description?: string; drill?: string }[];
  } | null,
  meetingNotes?: string | null,
) {
  try {
    // Load the player's persistent coaching profile (if any) to inject as prior context
    let playerProfile: string | null = null;
    let playerProfileSessionCount = 0;
    if (playerName?.trim()) {
      const profileRecord = await db.getPlayerProfile(playerName.trim());
      playerProfile = profileRecord?.coachingProfile ?? null;
      playerProfileSessionCount = profileRecord?.sessionCount ?? 0;
      if (playerProfile) {
        console.log(`[analysis] Loaded coaching profile for "${playerName}" (${playerProfileSessionCount} prior sessions)`);
      }
    }

    // Extract evenly-spaced frames from the full video so the AI sees the
    // entire match rather than just the first few seconds.
    // 18 frames gives ~3× better coverage than 6 — reduces the chance that
    // sampled frames land on breaks between games rather than active rallies.
    console.log("[analysis] Extracting frames from video:", videoUrl);
    const frames: ExtractedFrame[] = await extractAndUploadFrames(videoUrl, 18);

    if (frames.length === 0) {
      throw new Error("No frames could be extracted from the video");
    }

    console.log(`[analysis] Sending ${frames.length} frames to AI for analysis`);

    // Build the image content parts — one per extracted frame, labelled with
    // a 1-based frame number so the AI can reference them in its response.
    // Use base64 data URIs so the LLM API doesn't need to fetch from CloudFront
    // (Gemini returns "Cannot fetch content from URL" on some CDN origins).
    const imageContentParts = frames.map((frame, i) => {
      const motionLabel = frame.motionScore !== undefined
        ? frame.motionScore >= 1.0
          ? " [HIGH MOTION — active play]"
          : frame.motionScore < 0.7
            ? " [LOW MOTION — possible break, avoid using for clips]"
            : " [MEDIUM MOTION]"
        : "";
      return [
      {
        type: "text" as const,
        text: `Frame ${i + 1} of ${frames.length} (at ${formatTimestamp(frame.timestampSec)} in the video${motionLabel}):`,
      },
      {
        type: "image_url" as const,
        image_url: {
          url: frame.base64
            ? `data:image/jpeg;base64,${frame.base64}`
            : frame.url,
          detail: "auto" as const,
        },
      },
    ];
    }).flat();

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an expert squash coach analyzing game footage. You are given ${frames.length} frames extracted evenly across the full video duration, so you have visibility into the entire match.

${playerName ? `Focus your analysis specifically on the player: ${playerName}${playerDescription ? ` (${playerDescription})` : ''}. Ignore other players in the video.` : 'Analyze the primary player visible in the footage.'}

Your task is to identify the TOP 4 most impactful improvement areas for this player, based on how frequently each problem appears across the video frames.

${meetingNotes?.trim() ? `IMPORTANT: The coach recorded real-time verbal commentary during this session. The following are AI-transcribed meeting notes from that recording. These notes cover the full training session (which may include multiple matches). Use them as primary context for your analysis — they reflect what the coach observed and emphasised in person:

--- COACH MEETING NOTES ---
${meetingNotes.trim()}
--- END OF MEETING NOTES ---

Cross-reference these notes with what you observe in the video frames. Where the notes call out specific issues, prioritise them in your suggestions. Where you observe something the notes didn't mention, include it as an additional finding.` : ''}

${playerProfile ? `PLAYER COACHING PROFILE: The following is an accumulated coaching profile for ${playerName}, synthesized from ${playerProfileSessionCount} prior session(s) with a human coach. This represents long-term coaching knowledge about this player — treat it as ground truth about their tendencies and focus areas. Use it to calibrate your observations and reinforce recurring themes:

${playerProfile}

Cross-reference this profile with your video observations. Where the profile predicts an issue and you observe it in the frames, emphasise it. If you observe something not in the profile, flag it as a new finding.

` : ''}${coachNotes ? `IMPORTANT: A human coach has also provided structured analysis notes. You MUST incorporate these:

Coach: ${coachNotes.coachName ?? 'Unknown'}
${coachNotes.coachComment ? `Overall comment: ${coachNotes.coachComment}` : ''}
${coachNotes.strategyOverview?.strengths?.length ? `Strengths (coach-observed): ${coachNotes.strategyOverview.strengths.join('; ')}` : ''}
${coachNotes.strategyOverview?.strategyUsed?.length ? `Strategy used (coach-observed): ${coachNotes.strategyOverview.strategyUsed.join('; ')}` : ''}
${coachNotes.strategyOverview?.opponentWeaknesses?.length ? `Opponent weaknesses (coach-observed): ${coachNotes.strategyOverview.opponentWeaknesses.join('; ')}` : ''}
${coachNotes.strategyOverview?.strategicAdjustments?.length ? `Strategic adjustments (coach-recommended): ${coachNotes.strategyOverview.strategicAdjustments.join('; ')}` : ''}
${coachNotes.suggestions?.length ? `Coach-identified improvement areas:\n${coachNotes.suggestions.map((s, i) => `  ${i+1}. ${s.title}${s.description ? ': ' + s.description : ''}${s.drill ? ' | Drill: ' + s.drill : ''}`).join('\n')}` : ''}

Where your video observations align with the coach notes, reinforce them. Where they differ, note the discrepancy and defer to the coach's expertise.` : ''}

For each of the 4 areas:
1. Count how many times across all ${frames.length} frames you observe the problem occurring (occurrence_count)
2. Rank them from most frequent to least frequent
3. Focus only on "warning" or "error" severity issues — things that need improvement
4. Provide a concrete, actionable description of what to fix and why it matters

CRITICAL — Active play only: Some frames may show game breaks (players resting between points, towelling off, changing ends, serving preparation, between-game intervals). You MUST NOT reference these frames as examples of any issue. Only reference frames that clearly show ACTIVE RALLY PLAY — the ball is in motion, both players are moving, and a rally is in progress. If a frame shows players standing still, walking back to service position, or any non-rally moment, skip it entirely for clip selection.

For each suggestion, you MUST reference specific frame numbers that best illustrate the behavior:
- "frame_index": the 1-based frame number where the behavior STARTS or is first visible
- "end_frame_index": the 1-based frame number where the behavior ENDS or is last visible
- "frame_indices": up to 3 frame numbers (1-based) showing the issue at DIFFERENT moments in the video — spread them across the video so the player sees the pattern recurring, not the same moment three times. ALL selected frames MUST show active rally play (not breaks).
- For each entry in frame_indices, also provide a matching "frame_end_indices" array with the corresponding end frame for that clip. Each clip should be 3-8 seconds long. If you are unsure, set end frame = start frame + 1.

Choose frames that together form meaningful short clips (3-8 seconds each) showing the issue during active play.

Return EXACTLY 4 suggestions (or fewer if fewer than 4 distinct issues exist), sorted by occurrence_count descending.

Also count the player's shots by type across all frames and produce a structured strategy overview.

Return your analysis as a JSON object with this EXACT structure:
{
  "gameStats": {
    "totalShots": <estimated total shots played by the analyzed player>,
    "totalRallies": <estimated total number of rallies in the video>,
    "avgRallyLength": <estimated average shots per rally as a decimal, e.g. 8.5>,
    "shortRallyWinPct": <estimated percentage (0-100) of short rallies (0-4 shots) won by the analyzed player, or null if unknown>,
    "longRallyWinPct": <estimated percentage (0-100) of long rallies (9+ shots) won by the analyzed player, or null if unknown>,
    "forehand": { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> },
    "backhand": { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> },
    "drive":    { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> },
    "drop":     { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> },
    "lob":      { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> },
    "boast":    { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> },
    "volley":   { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> },
    "serve":    { "count": <integer>, "winners": <integer>, "unforcedErrors": <integer>, "forcedErrors": <integer> }
  },
  "strategyOverview": {
    "strengths": ["<bullet: something the player is already doing well>", "<bullet: another strength>"],
    "strategyUsed": ["<bullet: tactical approach or court positioning>", "<bullet: shot selection pattern>", "<bullet: another pattern if observed>"],
    "opponentWeaknesses": ["<bullet: an exploitable weakness in the opponent's game>", "<bullet: another weakness or pattern>"],
    "strategicAdjustments": ["<bullet: concrete change the player should make>", "<bullet: another adjustment>", "<bullet: third adjustment if applicable>"]
  },
  "performanceScore": <integer 0-100 overall performance score for the analyzed player>,
  "performanceGrade": "<A|B|C|D — A=excellent, B=good, C=needs work, D=significant issues>",
  "suggestions": [
    {
      "category": "technique|positioning|shot-selection|movement",
      "title": "string",
      "description": "string",
      "severity": "warning|error",
      "occurrence_count": <integer>,
      "impactEstimate": "<one sentence: why fixing this matters, e.g. 'Addressing this could reduce unforced errors by ~30% and win 3-4 extra points per game'>",
      "drill": "<one specific named drill the player can do in their next training session to fix this issue, e.g. 'Straight drive consistency — 20 consecutive drives from the back-left corner targeting the back-wall nick'>",
      "frame_indices": [<1-based start frame>, <optional 2nd start frame>, <optional 3rd start frame>],
      "frame_end_indices": [<1-based end frame for clip 1>, <end frame for clip 2 if present>, <end frame for clip 3 if present>],
      "frame_index": <same as first element of frame_indices, for backwards compat>,
      "end_frame_index": <same as first element of frame_end_indices, for backwards compat>
    }
  ]
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text: `Analyze these ${frames.length} frames from a squash game video.

1. Estimate the player's shot counts by type AND for each shot type estimate how many were winners, unforced errors, and forced errors.
2. Estimate totalShots (all shots by the analyzed player), totalRallies, avgRallyLength (shots per rally), shortRallyWinPct (% of 0-4 shot rallies won), and longRallyWinPct (% of 9+ shot rallies won). Use null for win percentages if you cannot estimate them.
3. Produce a strategyOverview with FOUR fields, each as an array of 2-3 short bullet strings (not prose paragraphs):
   - strengths: 2-3 things the player is already doing well (positive reinforcement)
   - strategyUsed: 2-3 bullets describing tactical approach, court positioning, and shot selection patterns
   - opponentWeaknesses: 2-3 bullets identifying exploitable weaknesses or patterns in the opponent's game
   - strategicAdjustments: 2-3 concrete, actionable bullets for how the player should change or improve their strategy
4. Identify the TOP 4 most frequent improvement areas, counted by how many times each problem appears across the frames. Return them ranked by occurrence_count (most frequent first). For each suggestion:
   - frame_indices: up to 3 start frame numbers (1-based) showing the issue at DIFFERENT moments during ACTIVE RALLIES ONLY — never pick frames showing breaks, rest periods, or serve preparation
   - frame_end_indices: matching end frame numbers for each clip in frame_indices — each clip should be 3-8 seconds long (set end = start + 1 if unsure)
   - frame_index: same as first element of frame_indices (backwards compat)
   - end_frame_index: same as first element of frame_end_indices (backwards compat)
   - impactEstimate: one sentence explaining why fixing this matters (e.g. estimated points saved)
   - drill: one specific named drill the player can do in their next training session
5. Provide an overall performanceScore (0-100) and performanceGrade (A/B/C/D) for the analyzed player.

Return the full JSON with gameStats, strategyOverview, and suggestions.`,
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
    // Sort by occurrence_count descending (most frequent first) and take top 4
    const MAX_CLIP_DURATION_SEC = 8;

    const rawSuggestions = (analysisData.suggestions || []) as Array<{
      category: string;
      title: string;
      description: string;
      severity: string;
      occurrence_count?: number;
      frame_index?: number;
      frame_indices?: number[];
      frame_end_indices?: number[];
      end_frame_index?: number;
      impactEstimate?: string;
      drill?: string;
    }>;
    const sortedSuggestions = rawSuggestions
      .sort((a, b) => (b.occurrence_count ?? 0) - (a.occurrence_count ?? 0))
      .slice(0, 4);

    // Extract gameStats and strategyOverview from AI response
    const gameStats = analysisData.gameStats ?? null;
    // Support both old (strategySummary string) and new (strategyOverview object) formats
    const strategyOverview = analysisData.strategyOverview ?? (
      analysisData.strategySummary
        ? { strategyUsed: analysisData.strategySummary, opponentWeaknesses: null, strategicAdjustments: null }
        : null
    );

    const suggestions = sortedSuggestions.map((s) => {
      // Resolve primary frame index (first of frame_indices, or frame_index, or 1)
      const frameIndicesRaw: number[] = Array.isArray(s.frame_indices) && s.frame_indices.length > 0
        ? s.frame_indices
        : s.frame_index != null ? [s.frame_index] : [1];

      const startIdx = Math.max(0, Math.min(frameIndicesRaw[0] - 1, frames.length - 1));
      const rawEndIdx = s.end_frame_index != null ? s.end_frame_index - 1 : startIdx + 1;
      const endIdx = Math.max(startIdx, Math.min(rawEndIdx, frames.length - 1));
      const startFrame = frames[startIdx];
      const endFrame = frames[endIdx];

      // Build array of up to 3 frame snapshots.
      // IMPORTANT: We deliberately ignore the AI's frame_end_indices because with only
      // 12 frames spread across a full match, adjacent frame timestamps are 30-60s apart.
      // The AI cannot reliably pick meaningful end frames at that resolution.
      // Instead, we always compute endSec = startSec + CLIP_DURATION_SEC (fixed 6s clip),
      // which gives an accurate, consistent short clip centred on the moment of interest.
      const CLIP_DURATION_SEC = 6;

      const frameSnapshots = frameIndicesRaw.slice(0, 3).map((fi) => {
        const idx = Math.max(0, Math.min(fi - 1, frames.length - 1));
        const f = frames[idx];
        if (!f) return null;

        // Start the clip 2 seconds BEFORE the frame timestamp so the viewer
        // sees the build-up, then the moment itself, then 4 seconds after.
        const startSec = Math.max(0, f.timestampSec - 2);
        const endSec = startSec + CLIP_DURATION_SEC;

        return {
          url: f.url,
          // Use the adjusted startSec so the video seeks to the right place
          timestampSec: startSec,
          timestamp: formatTimestamp(startSec),
          endTimestampSec: endSec,
          endTimestamp: formatTimestamp(endSec),
        };
      }).filter(Boolean);

      return {
        category: s.category,
        title: s.title,
        description: s.description,
        severity: s.severity,
        occurrenceCount: s.occurrence_count ?? null,
        impactEstimate: s.impactEstimate ?? null,
        drill: s.drill ?? null,
        frameSnapshots,
        // Legacy single-frame fields for backwards compat
        frameUrl: startFrame?.url ?? null,
        frameTimestamp: startFrame ? formatTimestamp(startFrame.timestampSec) : null,
        frameTimestampSec: startFrame?.timestampSec ?? null,
        endFrameTimestamp: endFrame ? formatTimestamp(endFrame.timestampSec) : null,
        endFrameTimestampSec: endFrame?.timestampSec ?? null,
      };
    });

    const performanceScore = analysisData.performanceScore ?? null;
    const performanceGrade = analysisData.performanceGrade ?? null;

    const result = { gameStats, strategyOverview, suggestions, performanceScore, performanceGrade };

    // ── Profile Synthesis ────────────────────────────────────────────────────
    // After a successful analysis that includes coach meeting notes, synthesize
    // (or update) the player's persistent coaching profile.  This runs async so
    // it doesn't block the analysis result from being returned to the caller.
    if (meetingNotes?.trim() && playerName?.trim()) {
      setImmediate(async () => {
        try {
          console.log(`[profile] Synthesizing coaching profile for "${playerName}"...`);
          const updatedProfile = await synthesizePlayerProfile(
            playerName.trim(),
            meetingNotes.trim(),
            result,
            playerProfile,
          );
          await db.upsertPlayerProfile(playerName.trim(), updatedProfile);
          console.log(`[profile] Profile updated for "${playerName}"`);
        } catch (err) {
          console.error(`[profile] Failed to synthesize profile for "${playerName}":`, err);
        }
      });
    }

    return result;
  } catch (error) {
    console.error("Video analysis failed:", error);
    // Re-throw with the original message so callers can surface it to the user
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(msg || "Failed to analyze video");
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
     * List video analyses for the authenticated user (scoped to their own videos).
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserVideoAnalyses(ctx.user.id);
    }),

    /**
     * Get a single video analysis by ID (owner or admin only).
     */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const video = await db.getVideoAnalysis(input.id);
        if (!video) return null;
        if (video.userId !== ctx.user.id && ctx.user.role !== "admin") return null;
        return video;
      }),

    /**
     * Upload a video and create analysis record (authenticated users only)
     */
    upload: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(255),
          playerName: z.string().optional(),
          playerDescription: z.string().optional(),
          videoBase64: z.string(),
          mimeType: z.string().default("video/mp4"),
        })
      )
      .mutation(async ({ input, ctx }) => {
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

        // Create database record (scoped to authenticated user)
        const videoId = await db.createVideoAnalysis({
          title: input.title,
          playerName: input.playerName,
          playerDescription: input.playerDescription,
          videoUrl,
          userId: ctx.user.id,
          status: "pending",
        });

        // Start analysis asynchronously (don't await)
        analyzeSquashVideoPublic(videoUrl, input.playerName, input.playerDescription)
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
          });

        return { id: videoId, videoUrl };
      }),

    /**
     * Re-run AI analysis on an existing uploaded video
     */
    reanalyze: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Fetch the existing record to get the videoUrl and player info
        const existing = await db.getVideoAnalysis(input.id);
        if (!existing) {
          throw new Error("Video not found");
        }
        if (existing.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new Error("Not authorized");
        }

        // Reset status to analyzing and clear old results
        await db.updateVideoAnalysis(input.id, {
          status: "analyzing",
          analysisResults: null,
          errorMessage: null,
        });

        // Re-run analysis asynchronously — pass coach notes and meeting notes if available
        analyzeSquashVideoPublic(
          existing.videoUrl,
          existing.playerName ?? undefined,
          existing.playerDescription ?? undefined,
          (existing.coachNotes as Parameters<typeof analyzeSquashVideoPublic>[3]) ?? null,
          existing.meetingNotes ?? null,
        )
          .then(async (results) => {
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
     * Delete a video analysis (owner or admin only)
     */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const video = await db.getVideoAnalysis(input.id);
        if (!video) throw new Error("Video not found");
        if (video.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new Error("Not authorized to delete this video");
        }
        await db.deleteVideoAnalysis(input.id);
        return { success: true };
      }),

    /**
     * Save coach notes for a video (structured analysis in same format as AI output).
     * Coach notes are persisted separately from AI results and fed into re-analysis.
     */
    saveCoachNotes: protectedProcedure
      .input(
        z.object({
          videoId: z.number(),
          coachNotes: z.object({
            coachName: z.string().optional(),
            coachComment: z.string().optional(),
            strategyOverview: z.object({
              strengths: z.array(z.string()).optional(),
              strategyUsed: z.array(z.string()).optional(),
              opponentWeaknesses: z.array(z.string()).optional(),
              strategicAdjustments: z.array(z.string()).optional(),
            }).optional(),
            suggestions: z.array(
              z.object({
                title: z.string(),
                description: z.string().optional(),
                drill: z.string().optional(),
              })
            ).optional(),
          }),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Only coaches and admins can save coach notes
        if (ctx.user.role !== "coach" && ctx.user.role !== "admin") {
          throw new Error("Only coaches and admins can save coach notes");
        }
        await db.saveCoachNotes(input.videoId, input.coachNotes);
        return { success: true };
      }),

    /**
     * Generate a shareable link token for a video (owner or admin only).
     */
    generateShareToken: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const video = await db.getVideoAnalysis(input.id);
        if (!video) throw new Error("Video not found");
        if (video.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new Error("Not authorized");
        }
        const token = await db.generateShareToken(input.id);
        return { token };
      }),

    /**
     * Get a video by its share token (public — no auth required).
     */
    getByShareToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        return db.getVideoAnalysisByShareToken(input.token);
      }),
  }),

  // ─── Player Profiles ──────────────────────────────────────────────────────────
  players: router({
    /**
     * Get the coaching profile for a specific player (by name).
     * Available to coaches and admins.
     */
    getProfile: protectedProcedure
      .input(z.object({ playerName: z.string() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== "coach" && ctx.user.role !== "admin") {
          throw new Error("Only coaches and admins can view player profiles");
        }
        return db.getPlayerProfile(input.playerName);
      }),

    /**
     * List all player coaching profiles (coaches and admins).
     */
    listProfiles: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "coach" && ctx.user.role !== "admin") {
        throw new Error("Only coaches and admins can list player profiles");
      }
      return db.listPlayerProfiles();
    }),

    /**
     * Manually trigger a profile synthesis pass for a player, using all their
     * past videos that have meeting notes.  Useful for bootstrapping the profile
     * from historical data without waiting for a new analysis run.
     * Admin only.
     */
    synthesizeProfile: protectedProcedure
      .input(z.object({ playerName: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new Error("Admin only");

        // Fetch all videos for this player that have meeting notes
        const allVideos = await db.getUserVideoAnalyses();
        const playerVideos = allVideos.filter(
          (v) =>
            v.playerName?.toLowerCase() === input.playerName.toLowerCase() &&
            v.meetingNotes?.trim() &&
            v.status === "complete",
        );

        if (playerVideos.length === 0) {
          throw new Error(`No completed videos with meeting notes found for player "${input.playerName}"`);
        }

        // Re-synthesize the profile from scratch using all available sessions
        let profile: string | null = null;
        for (const video of playerVideos) {
          profile = await synthesizePlayerProfile(
            input.playerName,
            video.meetingNotes!,
            (video.analysisResults as Parameters<typeof synthesizePlayerProfile>[2]) ?? {},
            profile,
          );
        }

        if (profile) {
          await db.upsertPlayerProfile(input.playerName, profile);
        }

        return { success: true, sessionsProcessed: playerVideos.length, profile };
      }),
  }),

  // ─── Admin ────────────────────────────────────────────────────────────────────
  admin: router({
    /**
     * List all users (admin only).
     */
    listUsers: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new Error("Admin only");
      return db.listAllUsers();
    }),

    /**
     * Update a user's role (admin only).
     */
    updateUserRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "coach", "admin"]) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new Error("Admin only");
        await db.updateUserRole(input.userId, input.role);
        return { success: true };
      }),
  }),

  // ─── Suggestion Feedback ──────────────────────────────────────────────────────
  feedback: router({
    /**
     * Submit or update a thumbs up/down vote for a suggestion.
     * Pass vote: null to remove the vote (toggle off).
     */
    submit: publicProcedure
      .input(
        z.object({
          videoId: z.number(),
          suggestionIdx: z.number(),
          vote: z.enum(["up", "down"]).nullable(),
          sessionKey: z.string().max(128),
        })
      )
      .mutation(async ({ input }) => {
        if (input.vote === null) {
          await db.deleteSuggestionFeedback(input.videoId, input.suggestionIdx, input.sessionKey);
        } else {
          await db.upsertSuggestionFeedback({
            videoId: input.videoId,
            suggestionIdx: input.suggestionIdx,
            vote: input.vote,
            sessionKey: input.sessionKey,
          });
        }
        return { success: true };
      }),
    /**
     * Get aggregated vote counts for all suggestions in a video.
     */
    getCounts: publicProcedure
      .input(z.object({ videoId: z.number() }))
      .query(async ({ input }) => {
        return db.getFeedbackCounts(input.videoId);
      }),
  }),
});
export type AppRouter = typeof appRouter;
