import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, videoAnalyses, InsertVideoAnalysis, VideoAnalysis } from "../drizzle/schema";
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
