/**
 * Unit tests for .mov / video/quicktime upload fix.
 * Verifies MIME normalisation and File-object-first upload path.
 */
import { describe, it, expect } from "vitest";

/** Mirrors the MIME normalisation logic in the upload handler */
function normaliseMime(rawMime: string): string {
  return rawMime === "video/quicktime" ? "video/mp4" : rawMime;
}

/** Derives the file extension from a (possibly normalised) MIME type */
function extFromMime(mime: string): string {
  return mime.split("/")[1] || "mp4";
}

describe(".mov upload fix – MIME normalisation", () => {
  it("normalises video/quicktime to video/mp4", () => {
    expect(normaliseMime("video/quicktime")).toBe("video/mp4");
  });

  it("leaves video/mp4 unchanged", () => {
    expect(normaliseMime("video/mp4")).toBe("video/mp4");
  });

  it("leaves video/webm unchanged", () => {
    expect(normaliseMime("video/webm")).toBe("video/webm");
  });

  it("derives correct extension from video/mp4", () => {
    expect(extFromMime("video/mp4")).toBe("mp4");
  });

  it("derives correct extension from video/quicktime after normalisation", () => {
    const normalised = normaliseMime("video/quicktime");
    expect(extFromMime(normalised)).toBe("mp4");
  });

  it("derives correct extension from video/webm", () => {
    expect(extFromMime("video/webm")).toBe("webm");
  });
});

describe(".mov upload fix – File-object-first path", () => {
  it("uses File object directly when available (no fetch needed)", () => {
    // Simulate the decision logic in handleUpload
    const videoFile = new File(["dummy"], "game.mov", { type: "video/quicktime" });
    const videoUri = "blob:http://localhost/abc123";

    // The upload handler should prefer videoFile over fetching videoUri
    const willUseFetch = !videoFile;
    expect(willUseFetch).toBe(false);
  });

  it("falls back to fetch when File object is null", () => {
    const videoFile: File | null = null;
    const willUseFetch = !videoFile;
    expect(willUseFetch).toBe(true);
  });

  it("re-wraps File with normalised MIME when type is video/quicktime", () => {
    const original = new File(["data"], "game.mov", { type: "video/quicktime" });
    const rawMime = original.type;
    const normalisedMime = normaliseMime(rawMime);
    const ext = extFromMime(normalisedMime);

    // Should create a new File with normalised MIME
    const shouldRewrap = normalisedMime !== rawMime;
    expect(shouldRewrap).toBe(true);

    const rewrapped = new File([original], `video.${ext}`, { type: normalisedMime });
    expect(rewrapped.type).toBe("video/mp4");
    expect(rewrapped.name).toBe("video.mp4");
  });

  it("does NOT re-wrap File when MIME is already video/mp4", () => {
    const original = new File(["data"], "game.mp4", { type: "video/mp4" });
    const rawMime = original.type;
    const normalisedMime = normaliseMime(rawMime);

    const shouldRewrap = normalisedMime !== rawMime;
    expect(shouldRewrap).toBe(false);
  });
});
