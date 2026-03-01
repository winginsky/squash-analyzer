import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";
import { ScrollView, Text, View, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

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

  // Auto-refresh while analysis is in progress
  useEffect(() => {
    if (videoData?.status === "analyzing" || videoData?.status === "pending") {
      const timer = setInterval(() => refetch(), 5000);
      return () => clearInterval(timer);
    }
  }, [videoData?.status, refetch]);

  const videoUrl = videoData?.videoUrl || "";
  const suggestions: Suggestion[] = useMemo(() => {
    if (!videoData?.analysisResults) return [];
    const results = videoData.analysisResults as { suggestions?: Suggestion[] };
    return results.suggestions || [];
  }, [videoData]);

  // Native main player (only initialised on native)
  const mainPlayer = useVideoPlayer(Platform.OS !== "web" ? videoUrl : "", (p) => {
    p.loop = false;
  });

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="max-w-5xl mx-auto w-full flex-1">
        <ScrollView className="flex-1">
          {/* Header */}
          <View className="px-6 pt-4 pb-2 flex-row items-center justify-between">
            <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 items-center justify-center -ml-2">
              <Text className="text-foreground text-2xl">←</Text>
            </TouchableOpacity>
            <Text className="text-xl font-bold text-foreground flex-1 text-center">
              {videoData?.title || "Video Analysis"}
            </Text>
            <View className="w-10" />
          </View>

          {/* Main Video Player */}
          <View className="px-6 mb-4">
            {Platform.OS === "web" ? (
              <View style={{ width: "100%", borderRadius: 16, overflow: "hidden" }}>
                {/* @ts-ignore */}
                <video
                  src={videoUrl}
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
                Tap "Show example clip" on any suggestion to jump to that moment in the video.
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

                    {/* Description */}
                    <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 21 }}>
                      {suggestion.description}
                    </Text>

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
