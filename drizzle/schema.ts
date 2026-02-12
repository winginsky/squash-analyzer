import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Video analyses table for storing squash game videos and their AI analysis results
 */
export const videoAnalyses = mysqlTable("video_analyses", {
  id: int("id").autoincrement().primaryKey(),
  /** User who uploaded the video (nullable for anonymous uploads) */
  userId: int("userId"),
  /** User-provided title for the video */
  title: varchar("title", { length: 255 }).notNull(),
  /** S3 URL of the uploaded video file */
  videoUrl: varchar("videoUrl", { length: 1024 }).notNull(),
  /** S3 URL of the video thumbnail (extracted from first frame) */
  thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
  /** Analysis status: pending, analyzing, complete, failed */
  status: mysqlEnum("status", ["pending", "analyzing", "complete", "failed"]).default("pending").notNull(),
  /** AI-generated analysis results stored as JSON */
  analysisResults: json("analysisResults"),
  /** Error message if analysis failed */
  errorMessage: text("errorMessage"),
  /** Timestamp when the video was uploaded */
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  /** Timestamp when the analysis was last updated */
  updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
});

export type VideoAnalysis = typeof videoAnalyses.$inferSelect;
export type InsertVideoAnalysis = typeof videoAnalyses.$inferInsert;
