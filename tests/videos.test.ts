import { describe, expect, it, beforeAll } from "vitest";
import * as db from "../server/db";

describe("Video Analysis API", () => {
  let testVideoId: number;

  beforeAll(async () => {
    // Create a test video analysis
    testVideoId = await db.createVideoAnalysis({
      title: "Test Squash Game",
      videoUrl: "https://example.com/test-video.mp4",
      status: "pending",
    });
  });

  it("creates a video analysis record", async () => {
    const videoId = await db.createVideoAnalysis({
      title: "New Test Video",
      videoUrl: "https://example.com/new-video.mp4",
      status: "pending",
    });

    expect(videoId).toBeDefined();
    expect(typeof videoId).toBe("number");
  });

  it("creates a video analysis with player information", async () => {
    const videoId = await db.createVideoAnalysis({
      title: "Player-Specific Analysis",
      playerName: "John Doe",
      playerDescription: "Wearing blue shirt, left side",
      videoUrl: "https://example.com/player-video.mp4",
      status: "pending",
    });

    const video = await db.getVideoAnalysis(videoId);
    expect(video).toBeDefined();
    expect(video?.playerName).toBe("John Doe");
    expect(video?.playerDescription).toBe("Wearing blue shirt, left side");
  });

  it("retrieves a video analysis by ID", async () => {
    const video = await db.getVideoAnalysis(testVideoId);

    expect(video).toBeDefined();
    expect(video?.id).toBe(testVideoId);
    expect(video?.title).toBe("Test Squash Game");
    expect(video?.status).toBe("pending");
  });

  it("lists all video analyses", async () => {
    const videos = await db.getUserVideoAnalyses();

    expect(videos).toBeDefined();
    expect(Array.isArray(videos)).toBe(true);
    expect(videos.length).toBeGreaterThan(0);
  });

  it("updates video analysis status", async () => {
    await db.updateVideoAnalysis(testVideoId, {
      status: "complete",
      analysisResults: {
        suggestions: [
          {
            category: "technique",
            title: "Test Suggestion",
            description: "Test description",
            severity: "success",
          },
        ],
      },
    });

    const updated = await db.getVideoAnalysis(testVideoId);
    expect(updated?.status).toBe("complete");
    expect(updated?.analysisResults).toBeDefined();
  });

  it("deletes a video analysis", async () => {
    const videoId = await db.createVideoAnalysis({
      title: "To Be Deleted",
      videoUrl: "https://example.com/delete-me.mp4",
      status: "pending",
    });

    await db.deleteVideoAnalysis(videoId);

    const deleted = await db.getVideoAnalysis(videoId);
    expect(deleted).toBeNull();
  });
});
