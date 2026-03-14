import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, videoAnalyses, InsertVideoAnalysis, VideoAnalysis, suggestionFeedback, InsertSuggestionFeedback } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get all video analyses for a user (or all if userId is null for anonymous)
 */
export async function getUserVideoAnalyses(userId?: number): Promise<VideoAnalysis[]> {
  const db = await getDb();
  if (!db) return [];

  if (userId) {
    return db.select().from(videoAnalyses).where(eq(videoAnalyses.userId, userId)).orderBy(desc(videoAnalyses.createdAt));
  } else {
    return db.select().from(videoAnalyses).orderBy(desc(videoAnalyses.createdAt));
  }
}

/**
 * Get a single video analysis by ID
 */
export async function getVideoAnalysis(id: number): Promise<VideoAnalysis | null> {
  const db = await getDb();
  if (!db) return null;

  const results = await db.select().from(videoAnalyses).where(eq(videoAnalyses.id, id));
  return results[0] || null;
}

/**
 * Create a new video analysis record
 */
export async function createVideoAnalysis(data: InsertVideoAnalysis): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(videoAnalyses).values(data);
  return result[0].insertId;
}

/**
 * Update video analysis status and results
 */
export async function updateVideoAnalysis(
  id: number,
  data: Partial<InsertVideoAnalysis>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(videoAnalyses).set(data).where(eq(videoAnalyses.id, id));
}

/**
 * Delete a video analysis
 */
export async function deleteVideoAnalysis(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(videoAnalyses).where(eq(videoAnalyses.id, id));
}

// ─── Suggestion Feedback ──────────────────────────────────────────────────────

/**
 * Upsert a feedback vote: if the same sessionKey + videoId + suggestionIdx already
 * exists, update the vote; otherwise insert a new row.
 */
export async function upsertSuggestionFeedback(
  data: InsertSuggestionFeedback
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.sessionKey) {
    // Check for existing row
    const existing = await db
      .select({ id: suggestionFeedback.id })
      .from(suggestionFeedback)
      .where(
        and(
          eq(suggestionFeedback.videoId, data.videoId),
          eq(suggestionFeedback.suggestionIdx, data.suggestionIdx),
          eq(suggestionFeedback.sessionKey, data.sessionKey)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(suggestionFeedback)
        .set({ vote: data.vote })
        .where(eq(suggestionFeedback.id, existing[0].id));
      return;
    }
  }

  await db.insert(suggestionFeedback).values(data);
}

/**
 * Remove a feedback vote (toggle off).
 */
export async function deleteSuggestionFeedback(
  videoId: number,
  suggestionIdx: number,
  sessionKey: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .delete(suggestionFeedback)
    .where(
      and(
        eq(suggestionFeedback.videoId, videoId),
        eq(suggestionFeedback.suggestionIdx, suggestionIdx),
        eq(suggestionFeedback.sessionKey, sessionKey)
      )
    );
}

/**
 * Get aggregated vote counts for all suggestions in a video.
 * Returns an array of { suggestionIdx, upCount, downCount }.
 */
export async function getFeedbackCounts(
  videoId: number
): Promise<{ suggestionIdx: number; upCount: number; downCount: number }[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      suggestionIdx: suggestionFeedback.suggestionIdx,
      vote: suggestionFeedback.vote,
      count: sql<number>`count(*)`,
    })
    .from(suggestionFeedback)
    .where(eq(suggestionFeedback.videoId, videoId))
    .groupBy(suggestionFeedback.suggestionIdx, suggestionFeedback.vote);

  // Aggregate into { suggestionIdx -> { up, down } }
  const map = new Map<number, { upCount: number; downCount: number }>();
  for (const row of rows) {
    const entry = map.get(row.suggestionIdx) ?? { upCount: 0, downCount: 0 };
    if (row.vote === "up") entry.upCount = Number(row.count);
    else entry.downCount = Number(row.count);
    map.set(row.suggestionIdx, entry);
  }

  return Array.from(map.entries()).map(([suggestionIdx, counts]) => ({
    suggestionIdx,
    ...counts,
  }));
}

// ─── Share Tokens ────────────────────────────────────────────────────────────

/**
 * Generate and save a share token for a video, returning the token.
 */
export async function generateShareToken(videoId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  await db.update(videoAnalyses).set({ shareToken: token }).where(eq(videoAnalyses.id, videoId));
  return token;
}

/**
 * Get a video analysis by share token (public access).
 */
export async function getVideoAnalysisByShareToken(token: string): Promise<VideoAnalysis | null> {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(videoAnalyses).where(eq(videoAnalyses.shareToken, token));
  return results[0] || null;
}

// ─── Admin / User Management ──────────────────────────────────────────────────

/**
 * List all users (admin only).
 */
export async function listAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

/**
 * Update a user's role.
 */
export async function updateUserRole(userId: number, role: "user" | "coach" | "admin"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

// ─── Coach Notes ──────────────────────────────────────────────────────────────

/**
 * Save (overwrite) coach notes for a video analysis.
 */
export async function saveCoachNotes(videoId: number, coachNotes: unknown): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(videoAnalyses)
    .set({ coachNotes: coachNotes as any })
    .where(eq(videoAnalyses.id, videoId));
}
