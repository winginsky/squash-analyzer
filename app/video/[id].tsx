import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";
import { ScrollView, Text, View, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

// ─── Frame reference link parser ─────────────────────────────────────────────
// Matches patterns like: "frame 6", "Frame 6", "(frame 6)", "(frame 6, ...)"
const FRAME_REF_REGEX = /\(?[Ff]rame\s+(\d+)(?:[^)]*)?\)?/g;

/**
 * Splits a description string into plain text segments and frame-reference
 * segments. Frame references are rendered as tappable highlighted links.
 */
function DescriptionWithFrameLinks({
  text,
  frames,
  onFrameTap,
  colors,
}: {
  text: string;
  frames: Array<{ timestampSec: number; url: string }>;
  onFrameTap: (timestampSec: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const parts: Array<{ type: "text" | "link"; content: string; frameIndex: number; timestampSec: number }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(FRAME_REF_REGEX.source, "g");

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index), frameIndex: -1, timestampSec: -1 });
    }
    const frameNum = parseInt(match[1], 10);
    const frameIdx = Math.max(0, Math.min(frameNum - 1, frames.length - 1));
    const ts = frames[frameIdx]?.timestampSec ?? -1;
    parts.push({ type: "link", content: match[0], frameIndex: frameIdx, timestampSec: ts });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex), frameIndex: -1, timestampSec: -1 });
  }

  return (
    <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 21 }}>
      {parts.map((part, i) =>
        part.type === "link" && part.timestampSec >= 0 ? (
          <Text
            key={i}
            onPress={() => onFrameTap(part.timestampSec)}
            style={{
              color: colors.primary,
              textDecorationLine: "underline",
              fontWeight: "600",
            }}
          >
            {part.content}
          </Text>
        ) : (
          <Text key={i}>{part.content}</Text>
        )
      )}
    </Text>
  );
}

type Suggestion = {
  id?: string;
  category: "technique" | "positioning" | "shot-selection" | "movement";
  title: string;
  description: string;
  severity: "success" | "warning" | "error";
  frameUrl?: string | null;
  frameTimestamp?: string | null;
  frameTimestampSec?: number | null;
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case "technique":      return "🎯";
    case "positioning":    return "📍";
    case "shot-selection": return "🎾";
    case "movement":       return "👟";
    default:               return "💡";
  }
};

const getSeverityStyle = (severity: string) => {
  switch (severity) {
    case "success": return { border: "#22C55E", bg: "rgba(34,197,94,0.08)",  badge: "#22C55E", badgeText: "#fff" };
    case "warning": return { border: "#F59E0B", bg: "rgba(245,158,11,0.08)", badge: "#F59E0B", badgeText: "#fff" };
    case "error":   return { border: "#EF4444", bg: "rgba(239,68,68,0.08)",  badge: "#EF4444", badgeText: "#fff" };
    default:        return { border: "#E5E7EB", bg: "transparent",            badge: "#687076", badgeText: "#fff" };
  }
};

const getSeverityLabel = (severity: string) => {
  switch (severity) {
    case "success": return "✓ Good";
    case "warning": return "⚠ Improve";
    case "error":   return "✕ Critical";
    default:        return severity;
  }
};

const CLIP_DURATION = 10; // seconds to play per suggestion clip

// ─── Web clip player ──────────────────────────────────────────────────────────
function WebClipPlayer({
  videoUrl,
  startSec,
  frameTimestamp,
  colors,
}: {
  videoUrl: string;
  startSec: number;
  frameTimestamp?: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggle = useCallback(() => {
    if (!open) {
      setOpen(true);
      // Give the element time to mount, then seek + play
      setTimeout(() => {
        const el = videoRef.current;
        if (!el) return;
        el.currentTime = startSec;
        el.play().catch(() => {});
        // Auto-pause after CLIP_DURATION seconds
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        stopTimerRef.current = setTimeout(() => {
          el.pause();
        }, CLIP_DURATION * 1000);
      }, 80);
    } else {
      // Collapse: pause and hide
      const el = videoRef.current;
      if (el) el.pause();
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      setOpen(false);
    }
  }, [open, startSec]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
  }, []);

  return (
    <View style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      {/* Toggle button */}
      <TouchableOpacity
        onPress={handleToggle}
        style={{ flexDirection: "row", alignItems: "center", padding: 10, backgroundColor: colors.surface }}
      >
        <Text style={{ fontSize: 14, marginRight: 6 }}>{open ? "⏸" : "▶️"}</Text>
        <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "600", flex: 1 }}>
          {open ? "Playing clip" : "Show example clip"}{frameTimestamp ? ` — at ${frameTimestamp}` : ""}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>{open ? "▲ Hide" : "▼ Show"}</Text>
      </TouchableOpacity>

      {/* Inline video — always mounted when open so ref is valid */}
      {open && (
        <View style={{ backgroundColor: "#000" }}>
          {/* @ts-ignore */}
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            style={{ width: "100%", aspectRatio: "16 / 9", display: "block", backgroundColor: "#000" }}
          />
          {frameTimestamp && (
            <View style={{
              position: "absolute", bottom: 8, right: 8,
              backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 6,
              paddingHorizontal: 8, paddingVertical: 3,
            }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>⏱ {frameTimestamp}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Native clip player (expo-video) ─────────────────────────────────────────
function NativeClipPlayer({
  videoUrl,
  startSec,
  frameTimestamp,
  colors,
}: {
  videoUrl: string;
  startSec: number;
  frameTimestamp?: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const player = useVideoPlayer(open ? videoUrl : "", (p) => {
    p.loop = false;
  });

  const handleToggle = useCallback(() => {
    if (!open) {
      setOpen(true);
      setTimeout(() => {
        try {
          player.currentTime = startSec;
          player.play();
          if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
          stopTimerRef.current = setTimeout(() => {
            try { player.pause(); } catch { /* ignore */ }
          }, CLIP_DURATION * 1000);
        } catch { /* ignore */ }
      }, 200);
    } else {
      try { player.pause(); } catch { /* ignore */ }
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      setOpen(false);
    }
  }, [open, player, startSec]);

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
  }, []);

  return (
    <View style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <TouchableOpacity
        onPress={handleToggle}
        style={{ flexDirection: "row", alignItems: "center", padding: 10, backgroundColor: colors.surface }}
      >
        <Text style={{ fontSize: 14, marginRight: 6 }}>{open ? "⏸" : "▶️"}</Text>
        <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "600", flex: 1 }}>
          {open ? "Playing clip" : "Show example clip"}{frameTimestamp ? ` — at ${frameTimestamp}` : ""}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>{open ? "▲ Hide" : "▼ Show"}</Text>
      </TouchableOpacity>

      {open && (
        <View style={{ backgroundColor: "#000", position: "relative" }}>
          <VideoView
            player={player}
            style={{ width: "100%", aspectRatio: 16 / 9 }}
            allowsFullscreen
            nativeControls
          />
          {frameTimestamp && (
            <View style={{
              position: "absolute", bottom: 8, right: 8,
              backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 6,
              paddingHorizontal: 8, paddingVertical: 3,
            }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>⏱ {frameTimestamp}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Platform-aware clip player ───────────────────────────────────────────────
function ClipPlayer(props: {
  videoUrl: string;
  startSec: number;
  frameTimestamp?: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  if (Platform.OS === "web") return <WebClipPlayer {...props} />;
  return <NativeClipPlayer {...props} />;
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function VideoDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams();
  const videoId = parseInt(id as string, 10);

  const { data: videoData, isLoading, refetch } = trpc.videos.get.useQuery({ id: videoId });
  const reanalyzeMutation = trpc.videos.reanalyze.useMutation({
    onSuccess: () => {
      // Start polling immediately after triggering re-analysis
      refetch();
    },
  });

  const isReanalyzing = reanalyzeMutation.isPending;
  const isAnalyzing = videoData?.status === "analyzing" || videoData?.status === "pending";

  const handleReanalyze = () => {
    if (!isReanalyzing && !isAnalyzing) {
      reanalyzeMutation.mutate({ id: videoId });
    }
  };

  // Auto-refresh while analysis is in progress
  useEffect(() => {
    if (isAnalyzing) {
      const timer = setInterval(() => refetch(), 5000);
      return () => clearInterval(timer);
    }
  }, [isAnalyzing, refetch]);

  const videoUrl = videoData?.videoUrl || "";
  const suggestions: Suggestion[] = useMemo(() => {
    if (!videoData?.analysisResults) return [];
    const results = videoData.analysisResults as { suggestions?: Suggestion[] };
    return results.suggestions || [];
  }, [videoData]);

  // Ref to the main web <video> element for seeking
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);

  // Build a flat frames array from all suggestions for timestamp lookup
  const allFrames = useMemo(() => {
    return suggestions
      .filter((s) => s.frameTimestampSec != null)
      .map((s) => ({ timestampSec: s.frameTimestampSec!, url: s.frameUrl ?? "" }))
      // Deduplicate by timestampSec and sort ascending
      .filter((f, i, arr) => arr.findIndex((x) => x.timestampSec === f.timestampSec) === i)
      .sort((a, b) => a.timestampSec - b.timestampSec);
  }, [suggestions]);

  // Native main player (only initialised on native — must be declared before seekMainVideo)
  const mainPlayer = useVideoPlayer(Platform.OS !== "web" ? videoUrl : "", (p) => {
    p.loop = false;
  });

  // Seek the main video player to a given timestamp and scroll to top
  const seekMainVideo = useCallback((timestampSec: number) => {
    if (Platform.OS === "web") {
      const el = mainVideoRef.current;
      if (el) {
        el.currentTime = timestampSec;
        el.play().catch(() => {});
      }
    } else {
      try {
        mainPlayer.currentTime = timestampSec;
        mainPlayer.play();
      } catch { /* ignore */ }
    }
    // Scroll back to top so the user sees the main video start playing
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, [mainPlayer]);

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="max-w-5xl mx-auto w-full flex-1">
        <ScrollView className="flex-1" ref={scrollViewRef}>
          {/* Header */}
          <View className="px-6 pt-4 pb-2 flex-row items-center justify-between">
            <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 items-center justify-center -ml-2">
              <Text className="text-foreground text-2xl">←</Text>
            </TouchableOpacity>
            <Text className="text-xl font-bold text-foreground flex-1 text-center">
              {videoData?.title || "Video Analysis"}
            </Text>
            {/* Re-analyze button */}
            <TouchableOpacity
              onPress={handleReanalyze}
              disabled={isReanalyzing || isAnalyzing}
              style={{
                width: 40, height: 40,
                alignItems: "center", justifyContent: "center",
                backgroundColor: (isReanalyzing || isAnalyzing) ? colors.border : colors.primary + "22",
                borderRadius: 20,
                opacity: (isReanalyzing || isAnalyzing) ? 0.5 : 1,
              }}
            >
              <Text style={{ fontSize: 18 }}>{isReanalyzing || isAnalyzing ? "⏳" : "🔄"}</Text>
            </TouchableOpacity>
          </View>

          {/* Main Video Player */}
          <View className="px-6 mb-4">
            {Platform.OS === "web" ? (
              <View style={{ width: "100%", borderRadius: 16, overflow: "hidden" }}>
                {/* @ts-ignore */}
                <video
                  ref={mainVideoRef}
                  src={videoUrl || undefined}
                  controls
                  style={{ width: "100%", aspectRatio: "16 / 9", maxHeight: 600, display: "block", backgroundColor: colors.surface }}
                />
              </View>
            ) : (
              <VideoView
                player={mainPlayer}
                style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: colors.surface }}
                allowsFullscreen
                nativeControls
              />
            )}
          </View>

          {/* Player Information */}
          {videoData && (videoData.playerName || videoData.playerDescription) && (
            <View className="px-6 mb-4">
              <View className="bg-surface rounded-xl p-4 border border-border">
                <View className="flex-row items-center mb-2">
                  <View className="w-8 h-8 bg-primary/10 rounded-full items-center justify-center mr-3">
                    <Text className="text-primary text-base">🎾</Text>
                  </View>
                  <Text className="text-base font-semibold text-foreground">Analyzing Player</Text>
                </View>
                {videoData.playerName && (
                  <Text className="text-foreground font-medium mb-1">{videoData.playerName}</Text>
                )}
                {videoData.playerDescription && (
                  <Text className="text-sm text-muted">{videoData.playerDescription}</Text>
                )}
              </View>
            </View>
          )}

          {/* Analysis Status */}
          {videoData && (
            <View className="px-6 mb-4">
              {videoData.status === "complete" && (
                <View className="bg-success/20 rounded-xl p-4 flex-row items-center">
                  <View className="w-10 h-10 bg-success/30 rounded-full items-center justify-center mr-3">
                    <Text className="text-success text-xl">✓</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-success font-semibold text-base">Analysis Complete</Text>
                    <Text className="text-success/80 text-sm">{suggestions.length} suggestions generated</Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleReanalyze}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6,
                      backgroundColor: colors.surface,
                      borderRadius: 20, borderWidth: 1, borderColor: colors.border,
                      flexDirection: "row", alignItems: "center", gap: 4,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>🔄</Text>
                    <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "600" }}>Re-analyze</Text>
                  </TouchableOpacity>
                </View>
              )}
              {(videoData.status === "analyzing" || videoData.status === "pending") && (
                <View className="bg-warning/20 rounded-xl p-4 flex-row items-center">
                  <View className="w-10 h-10 bg-warning/30 rounded-full items-center justify-center mr-3">
                    <Text className="text-warning text-xl">⏳</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-warning font-semibold text-base">Analyzing Video…</Text>
                    <Text className="text-warning/80 text-sm">Extracting frames and running AI analysis. This may take 1–2 minutes. Page refreshes automatically.</Text>
                  </View>
                </View>
              )}
              {videoData.status === "failed" && (
                <View className="bg-error/20 rounded-xl p-4 flex-row items-center">
                  <View className="w-10 h-10 bg-error/30 rounded-full items-center justify-center mr-3">
                    <Text className="text-error text-xl">✕</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-error font-semibold text-base">Analysis Failed</Text>
                    <Text className="text-error/80 text-sm">{videoData.errorMessage || "Please try again"}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleReanalyze}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6,
                      backgroundColor: colors.surface,
                      borderRadius: 20, borderWidth: 1, borderColor: colors.border,
                      flexDirection: "row", alignItems: "center", gap: 4,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>🔄</Text>
                    <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "600" }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Loading */}
          {isLoading && (
            <View className="px-6 pb-6">
              <Text className="text-muted text-center">Loading analysis…</Text>
            </View>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <View className="px-6 pb-8">
              <Text className="text-2xl font-bold text-foreground mb-1">AI Coaching Suggestions</Text>
              <Text className="text-sm text-muted mb-5">
                Tap a <Text style={{ color: colors.primary, fontWeight: "600" }}>frame reference</Text> in any suggestion to jump to that moment, or tap "Show example clip" for a short preview.
              </Text>

              {suggestions.map((suggestion, idx) => {
                const style = getSeverityStyle(suggestion.severity);
                const hasSec = suggestion.frameTimestampSec != null;
                return (
                  <View
                    key={suggestion.id ?? idx}
                    style={{
                      marginBottom: 16,
                      borderRadius: 16,
                      borderLeftWidth: 4,
                      borderLeftColor: style.border,
                      backgroundColor: style.bg,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    {/* Title row */}
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                      <Text style={{ fontSize: 22, marginRight: 8 }}>{getCategoryIcon(suggestion.category)}</Text>
                      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, flex: 1 }}>
                        {suggestion.title}
                      </Text>
                      <View style={{ backgroundColor: style.badge, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 8 }}>
                        <Text style={{ color: style.badgeText, fontSize: 11, fontWeight: "700" }}>
                          {getSeverityLabel(suggestion.severity)}
                        </Text>
                      </View>
                    </View>

                    {/* Description — frame references are clickable links */}
                    <DescriptionWithFrameLinks
                      text={suggestion.description}
                      frames={allFrames}
                      onFrameTap={seekMainVideo}
                      colors={colors}
                    />

                    {/* Category label */}
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, textTransform: "uppercase", marginTop: 8, letterSpacing: 0.5 }}>
                      {suggestion.category.replace("-", " ")}
                    </Text>

                    {/* Inline clip player */}
                    {hasSec && videoUrl ? (
                      <ClipPlayer
                        videoUrl={videoUrl}
                        startSec={suggestion.frameTimestampSec!}
                        frameTimestamp={suggestion.frameTimestamp}
                        colors={colors}
                      />
                    ) : suggestion.frameTimestamp ? (
                      <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center" }}>
                        <Text style={{ fontSize: 12, color: colors.muted }}>⏱ Occurs at {suggestion.frameTimestamp}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </ScreenContainer>
  );
}
