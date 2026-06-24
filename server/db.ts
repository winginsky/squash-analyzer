import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { users, videoAnalyses, InsertVideoAnalysis, VideoAnalysis, suggestionFeedback, InsertSuggestionFeedback, playerProfiles, PlayerProfile } from "../drizzle/schema";
import type { User } from "../drizzle/schema";

export type UserRecord = User;

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

// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

export async function getUserById(id: number): Promise<UserRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] ?? null;
}

export async function getUserByOpenId(openId: string): Promise<UserRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0] ?? null;
}

type CreateUserInput = {
  email: string;
  name?: string;
  passwordHash?: string;
  loginMethod?: string;
  role?: "user" | "coach" | "admin";
};

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(users).values({
    email: input.email,
    name: input.name ?? null,
    passwordHash: input.passwordHash ?? null,
    loginMethod: input.loginMethod ?? "email",
    role: input.role ?? "user",
    lastSignedIn: new Date(),
  });

  const user = await getUserById(result[0].insertId);
  if (!user) throw new Error("Failed to retrieve created user");
  return user;
}

type UpsertByOpenIdInput = {
  openId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  loginMethod?: string;
  role?: "user" | "coach" | "admin";
};

/**
 * Create or update a user identified by their OAuth provider ID.
 * If an existing user has the same email but no openId, links the accounts.
 */
export async function upsertUserByOpenId(input: UpsertByOpenIdInput): Promise<UserRecord> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Try to find by openId first
  let existing = await getUserByOpenId(input.openId);

  // If not found by openId, try by email (link existing email account)
  if (!existing) {
    existing = await getUserByEmail(input.email);
  }

  const now = new Date();

  if (existing) {
    // Update existing user
    const updateData: Record<string, unknown> = {
      openId: input.openId,
      lastSignedIn: now,
    };
    if (input.name) updateData.name = input.name;
    if (input.avatarUrl) updateData.avatarUrl = input.avatarUrl;
    if (input.loginMethod) updateData.loginMethod = input.loginMethod;
    if (input.role) updateData.role = input.role;

    await db.update(users).set(updateData).where(eq(users.id, existing.id));
    const updated = await getUserById(existing.id);
    if (!updated) throw new Error("Failed to retrieve updated user");
    return updated;
  }

  // Create new user
  const result = await db.insert(users).values({
    openId: input.openId,
    email: input.email,
    name: input.name ?? null,
    avatarUrl: input.avatarUrl ?? null,
    loginMethod: input.loginMethod ?? "google",
    role: input.role ?? "user",
    lastSignedIn: now,
  });

  const user = await getUserById(result[0].insertId);
  if (!user) throw new Error("Failed to retrieve created user");
  return user;
}

export async function updateUserLastSignedIn(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Video analyses
// ---------------------------------------------------------------------------

/**
 * Get all video analyses for a user (or all if no userId - admin only).
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

export async function upsertSuggestionFeedback(
  data: InsertSuggestionFeedback
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.sessionKey) {
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

export async function generateShareToken(videoId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  await db.update(videoAnalyses).set({ shareToken: token }).where(eq(videoAnalyses.id, videoId));
  return token;
}

export async function getVideoAnalysisByShareToken(token: string): Promise<VideoAnalysis | null> {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(videoAnalyses).where(eq(videoAnalyses.shareToken, token));
  return results[0] || null;
}

// ─── Admin / User Management ──────────────────────────────────────────────────

export async function listAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserRole(userId: number, role: "user" | "coach" | "admin"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

// ─── Zombie Job Recovery ───────────────────────────────────────────────────────

/**
 * Reset any videos stuck in "analyzing" or "pending" state to "failed".
 * Called on server startup to recover from crashes / restarts mid-analysis.
 */
export async function resetZombieJobs(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .update(videoAnalyses)
    .set({
      status: "failed",
      errorMessage: "Analysis was interrupted by a server restart. Please click Retry.",
    })
    .where(
      sql`${videoAnalyses.status} IN ('analyzing', 'pending')`
    );
  return (result[0] as any).affectedRows ?? 0;
}

// ─── Coach Notes ──────────────────────────────────────────────────────────────

export async function saveCoachNotes(videoId: number, coachNotes: unknown): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(videoAnalyses)
    .set({ coachNotes: coachNotes as any })
    .where(eq(videoAnalyses.id, videoId));
}

// ─── Player Profiles ──────────────────────────────────────────────────────────

/**
 * Get the coaching profile for a player (case-insensitive match).
 */
export async function getPlayerProfile(playerName: string): Promise<PlayerProfile | null> {
  const db = await getDb();
  if (!db) return null;
  const results = await db
    .select()
    .from(playerProfiles)
    .where(sql`LOWER(${playerProfiles.playerName}) = LOWER(${playerName})`)
    .limit(1);
  return results[0] ?? null;
}

/**
 * Create or update the coaching profile for a player.
 * Increments session count on each update.
 */
export async function upsertPlayerProfile(
  playerName: string,
  coachingProfile: string,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getPlayerProfile(playerName);
  if (existing) {
    await db
      .update(playerProfiles)
      .set({
        coachingProfile,
        sessionCount: existing.sessionCount + 1,
      })
      .where(eq(playerProfiles.id, existing.id));
  } else {
    await db.insert(playerProfiles).values({
      playerName,
      coachingProfile,
      sessionCount: 1,
    });
  }
}

/**
 * List all player coaching profiles.
 */
export async function listPlayerProfiles(): Promise<PlayerProfile[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(playerProfiles).orderBy(desc(playerProfiles.lastUpdatedAt));
}
