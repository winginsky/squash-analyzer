import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Platform, Share } from "react-native";
import { trpc } from "@/lib/trpc";
import { ScrollView, Text, View, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { VideoView, useVideoPlayer } from "expo-video";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

// ─── Thumbnail clip button ────────────────────────────────────────────────────
/**
 * A single clickable thumbnail that shows the extracted frame image with a
 * timestamp badge. Tapping it seeks the main video to that moment.
 */
function ThumbnailClip({
  frameUrl,
  frameTimestamp,
  endFrameTimestamp,
  timestampSec,
  endTimestampSec,
  onPress,
  colors,
}: {
  frameUrl: string;
  frameTimestamp: string;
  endFrameTimestamp?: string | null;
  timestampSec: number;
  endTimestampSec?: number | null;
  onPress: (startSec: number, endSec?: number, loop?: boolean) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [pressed, setPressed] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  // Always show a range — endTimestampSec should always be set now
  const hasRange = !!(endFrameTimestamp && endFrameTimestamp !== frameTimestamp);
  const durationSec = endTimestampSec != null ? Math.round(endTimestampSec - timestampSec) : null;
  const badgeLabel = hasRange ? `${frameTimestamp} → ${endFrameTimestamp}` : frameTimestamp;
  const durationLabel = durationSec != null ? `${durationSec}s` : null;
  return (
    <TouchableOpacity
      onPress={() => {
        const nowLooping = !isLooping;
        setIsLooping(nowLooping);
        onPress(timestampSec, endTimestampSec ?? undefined, nowLooping);
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        marginRight: 10,
        borderRadius: 10,
        overflow: "hidden",
        borderWidth: 2,
        borderColor: isLooping ? colors.primary : pressed ? colors.primary : colors.border,
        opacity: pressed ? 0.85 : 1,
        width: 180,
      }}
    >
      {/* Frame image */}
      <View style={{ width: 180, height: 90, backgroundColor: colors.surface }}>
        {/* @ts-ignore */}
        <img
          src={frameUrl}
          alt={`Frame at ${frameTimestamp}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {/* Play/loop icon overlay */}
        <View style={{
          position: "absolute", inset: 0,
          alignItems: "center", justifyContent: "center",
          backgroundColor: isLooping ? "rgba(10,126,164,0.25)" : "rgba(0,0,0,0.18)",
        }}>
          <View style={{
            width: 32, height: 32, borderRadius: 16,
            backgroundColor: isLooping ? colors.primary : "rgba(0,0,0,0.55)",
            alignItems: "center", justifyContent: "center",
          }}>
            <Text style={{ color: "#fff", fontSize: isLooping ? 14 : 12, marginLeft: isLooping ? 0 : 2 }}>
              {isLooping ? "↺" : "▶"}
            </Text>
          </View>
        </View>
        {/* Duration badge top-left */}
        {durationLabel && (
          <View style={{
            position: "absolute", top: 4, left: 4,
            backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 5,
            paddingHorizontal: 5, paddingVertical: 2,
          }}>
            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{durationLabel}</Text>
          </View>
        )}
        {/* Timestamp range badge bottom-right */}
        <View style={{
          position: "absolute", bottom: 4, right: 4,
          backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 5,
          paddingHorizontal: 5, paddingVertical: 2,
        }}>
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>⏱ {badgeLabel}</Text>
        </View>
      </View>
      {/* Label */}
      <View style={{ backgroundColor: isLooping ? colors.primary + "18" : colors.surface, paddingHorizontal: 8, paddingVertical: 5 }}>
        <Text style={{ fontSize: 11, color: isLooping ? colors.primary : colors.foreground, fontWeight: "600", textAlign: "center" }}>
          {isLooping ? "↺ Looping — tap to stop" : `▶ ${frameTimestamp}${hasRange ? ` → ${endFrameTimestamp}` : ""}`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Shot stat types ─────────────────────────────────────────────────────────
type ShotStat = {
  count: number;
  winners?: number | null;
  unforcedErrors?: number | null;
  forcedErrors?: number | null;
};

type GameStats = {
  // Summary fields
  totalShots?: number | null;
  totalRallies?: number | null;
  avgRallyLength?: number | null;
  shortRallyWinPct?: number | null;
  longRallyWinPct?: number | null;
  // Shot type breakdown — new format (object) or legacy (number)
  forehand?: ShotStat | number | null;
  backhand?: ShotStat | number | null;
  drive?:    ShotStat | number | null;
  drop?:     ShotStat | number | null;
  lob?:      ShotStat | number | null;
  boast?:    ShotStat | number | null;
  volley?:   ShotStat | number | null;
  serve?:    ShotStat | number | null;
};

type ShotKey = "forehand" | "backhand" | "drive" | "drop" | "lob" | "boast" | "volley" | "serve";

/** Normalise a shot stat field — handles both new object format and legacy number */
function normaliseShotStat(val: ShotStat | number | null | undefined): ShotStat | null {
  if (val == null) return null;
  if (typeof val === "number") return val > 0 ? { count: val } : null;
  if (typeof val === "object" && val.count > 0) return val;
  return null;
}

const STAT_ITEMS: { key: ShotKey; label: string; matIcon: string }[] = [
  { key: "forehand",  label: "Forehand",  matIcon: "sports-tennis" },
  { key: "backhand",  label: "Backhand",  matIcon: "flip" },
  { key: "drive",     label: "Drive",     matIcon: "arrow-forward" },
  { key: "drop",      label: "Drop",      matIcon: "arrow-downward" },
  { key: "lob",       label: "Lob",       matIcon: "arrow-upward" },
  { key: "boast",     label: "Boast",     matIcon: "call-made" },
  { key: "volley",    label: "Volley",    matIcon: "bolt" },
  { key: "serve",     label: "Serve",     matIcon: "sports" },
];

type FrameSnapshot = {
  url: string;
  timestampSec: number;
  timestamp: string;
  endTimestampSec?: number | null;
  endTimestamp?: string | null;
};

type Suggestion = {
  id?: string;
  category: "technique" | "positioning" | "shot-selection" | "movement";
  title: string;
  description: string;
  severity: "success" | "warning" | "error";
  occurrenceCount?: number | null;
  impactEstimate?: string | null;
  drill?: string | null;
  frameSnapshots?: FrameSnapshot[] | null;
  // Legacy single-frame fields
  frameUrl?: string | null;
  frameTimestamp?: string | null;
  frameTimestampSec?: number | null;
  endFrameTimestamp?: string | null;
  endFrameTimestampSec?: number | null;
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

  // ─── Suggestion feedback (thumbs up/down) ────────────────────────────────
  // Stored as { [videoId_suggestionIdx]: "up" | "down" | null }
  const FEEDBACK_KEY = `suggestion_feedback_v${videoId}`;
  const [feedback, setFeedback] = useState<Record<string, "up" | "down" | null>>({});
  useEffect(() => {
    AsyncStorage.getItem(FEEDBACK_KEY).then((raw) => {
      if (raw) {
        try { setFeedback(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
  }, [FEEDBACK_KEY]);
  const handleFeedback = useCallback(async (suggestionIdx: number, vote: "up" | "down") => {
    const key = String(suggestionIdx);
    const current = feedback[key];
    const next = current === vote ? null : vote; // toggle off if same
    const updated = { ...feedback, [key]: next };
    setFeedback(updated);
    await AsyncStorage.setItem(FEEDBACK_KEY, JSON.stringify(updated));
  }, [feedback, FEEDBACK_KEY]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!videoData?.analysisResults) return [];
    const results = videoData.analysisResults as { suggestions?: Suggestion[] };
    return results.suggestions || [];
  }, [videoData]);

  // ─── Share card ───────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    const title = videoData?.title || "Squash Analysis";
    const player = videoData?.playerName ? `Player: ${videoData.playerName}` : "";
    const results = videoData?.analysisResults as { performanceScore?: number; performanceGrade?: string } | undefined;
    const grade = results?.performanceGrade ?? "?";
    const score = results?.performanceScore ?? "?";
    const topDrill = suggestions[0]?.drill ? `\n🎯 Top drill: ${suggestions[0].drill}` : "";
    const topArea = suggestions[0]?.title ? `\n📌 Top improvement: ${suggestions[0].title}` : "";
    const message = `🏸 ${title}\n${player}\n\nPerformance: ${grade} (${score}/100)${topArea}${topDrill}\n\nAnalyzed with Squash Analyzer`;
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        try { await (navigator as any).share({ title, text: message }); } catch { /* user cancelled */ }
      } else {
        try {
          await navigator.clipboard.writeText(message);
          alert("Summary copied to clipboard!");
        } catch {
          alert(message);
        }
      }
    } else {
      try { await Share.share({ message, title }); } catch { /* user cancelled */ }
    }
  }, [videoData, suggestions]);

  const gameStats: GameStats | null = useMemo(() => {
    if (!videoData?.analysisResults) return null;
    const results = videoData.analysisResults as { gameStats?: GameStats };
    return results.gameStats ?? null;
  }, [videoData]);

  type StrategyOverview = {
    strengths?: string[] | string | null;
    strategyUsed?: string[] | string | null;
    opponentWeaknesses?: string[] | string | null;
    strategicAdjustments?: string[] | string | null;
  };

  /** Normalise a strategy field — handles both new array format and legacy string */
  const normStrategyField = (val: string[] | string | null | undefined): string[] | null => {
    if (val == null) return null;
    if (Array.isArray(val)) return val.filter(Boolean);
    if (typeof val === "string" && val.trim()) return [val];
    return null;
  };

  const strategyOverview: StrategyOverview | null = useMemo(() => {
    if (!videoData?.analysisResults) return null;
    const results = videoData.analysisResults as {
      strategyOverview?: StrategyOverview;
      strategySummary?: string; // legacy field
    };
    if (results.strategyOverview) return results.strategyOverview;
    // Backwards-compat: old analyses stored a plain string
    if (results.strategySummary) return { strategyUsed: results.strategySummary, opponentWeaknesses: null, strategicAdjustments: null };
    return null;
  }, [videoData]);

  const [strategyExpanded, setStrategyExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"stats" | "strategy" | "improvements">("stats");

  const performanceScore: number | null = useMemo(() => {
    if (!videoData?.analysisResults) return null;
    const r = videoData.analysisResults as { performanceScore?: number };
    return r.performanceScore ?? null;
  }, [videoData]);

  const performanceGrade: string | null = useMemo(() => {
    if (!videoData?.analysisResults) return null;
    const r = videoData.analysisResults as { performanceGrade?: string };
    return r.performanceGrade ?? null;
  }, [videoData]);

  // Refs for section scroll-to
  const statsRef = useRef<View | null>(null);
  const strategyRef = useRef<View | null>(null);
  const improvementsRef = useRef<View | null>(null);

  // Ref to the main web <video> element for seeking
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);

  // Native main player (only initialised on native — must be declared before seekMainVideo)
  const mainPlayer = useVideoPlayer(Platform.OS !== "web" ? videoUrl : "", (p) => {
    p.loop = false;
  });

  // Ref to track the current loop interval so we can cancel it
  const loopIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loopHandlerRef = useRef<((this: HTMLVideoElement) => void) | null>(null);

  const stopLoop = useCallback(() => {
    if (loopIntervalRef.current != null) {
      clearInterval(loopIntervalRef.current);
      loopIntervalRef.current = null;
    }
    if (Platform.OS === "web") {
      const el = mainVideoRef.current;
      if (el && loopHandlerRef.current) {
        el.removeEventListener("timeupdate", loopHandlerRef.current as EventListener);
        loopHandlerRef.current = null;
      }
    }
  }, []);

  // Seek the main video player to a given timestamp and scroll to top.
  // If endSec is provided, auto-pause or loop the video between start and end.
  const seekMainVideo = useCallback((startSec: number, endSec?: number, loop?: boolean) => {
    // Always cancel any existing loop first
    stopLoop();

    if (Platform.OS === "web") {
      const el = mainVideoRef.current;
      if (el) {
        el.currentTime = startSec;
        el.play().catch(() => {});
        if (endSec != null && endSec > startSec) {
          if (loop) {
            // Loop mode: seek back to start whenever we pass endSec
            const handler = function(this: HTMLVideoElement) {
              if (this.currentTime >= endSec) {
                this.currentTime = startSec;
              }
            };
            loopHandlerRef.current = handler;
            el.addEventListener("timeupdate", handler as EventListener);
          } else {
            // One-shot mode: pause at endSec.
            // IMPORTANT: store in loopHandlerRef so stopLoop() can remove it on the next tap.
            // Without this, orphaned handlers accumulate and the earliest one always fires first,
            // causing all clips to appear to stop at the same (first) end timestamp.
            const handler = function(this: HTMLVideoElement) {
              if (this.currentTime >= endSec) {
                this.pause();
                // Also clean up the ref so stopLoop doesn't try to remove it twice
                if (loopHandlerRef.current === handler) {
                  loopHandlerRef.current = null;
                }
                this.removeEventListener("timeupdate", handler as EventListener);
              }
            };
            loopHandlerRef.current = handler;
            el.addEventListener("timeupdate", handler as EventListener);
          }
        }
      }
    } else {
      try {
        mainPlayer.currentTime = startSec;
        mainPlayer.play();
        if (endSec != null && endSec > startSec) {
          const durationMs = (endSec - startSec) * 1000;
          if (loop) {
            // Loop mode: reschedule seek every clip duration
            const doLoop = () => {
              try {
                mainPlayer.currentTime = startSec;
                mainPlayer.play();
              } catch { /* ignore */ }
            };
            loopIntervalRef.current = setInterval(doLoop, durationMs);
          } else {
            // One-shot: pause after clip
            setTimeout(() => {
              try { mainPlayer.pause(); } catch { /* ignore */ }
            }, durationMs);
          }
        }
      } catch { /* ignore */ }
    }
    // Scroll back to top so the user sees the main video start playing
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, [mainPlayer, stopLoop]);

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
            {/* Action buttons row */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {/* Share button */}
              {videoData?.status === "complete" && (
                <TouchableOpacity
                  onPress={handleShare}
                  style={{
                    width: 40, height: 40,
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: colors.primary + "22",
                    borderRadius: 20,
                  }}
                >
                  <MaterialIcons name="share" size={18} color={colors.primary} />
                </TouchableOpacity>
              )}
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

          {/* Performance Score Hero */}
          {performanceScore != null && performanceGrade != null && (() => {
            const gradeColors: Record<string, { bg: string; text: string; ring: string }> = {
              A: { bg: "rgba(34,197,94,0.12)",  text: "#16A34A", ring: "#22C55E" },
              B: { bg: "rgba(59,130,246,0.12)",  text: "#1D4ED8", ring: "#3B82F6" },
              C: { bg: "rgba(245,158,11,0.12)",  text: "#B45309", ring: "#F59E0B" },
              D: { bg: "rgba(239,68,68,0.12)",   text: "#B91C1C", ring: "#EF4444" },
            };
            const gc = gradeColors[performanceGrade] ?? gradeColors["C"];
            return (
              <View className="px-6 mb-4">
                <View style={{
                  backgroundColor: gc.bg,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: gc.ring + "55",
                  padding: 16,
                  flexDirection: "row",
                  alignItems: "center",
                }}>
                  {/* Grade circle */}
                  <View style={{
                    width: 64, height: 64, borderRadius: 32,
                    borderWidth: 3, borderColor: gc.ring,
                    backgroundColor: gc.bg,
                    alignItems: "center", justifyContent: "center",
                    marginRight: 16,
                  }}>
                    <Text style={{ fontSize: 26, fontWeight: "900", color: gc.text }}>{performanceGrade}</Text>
                  </View>
                  {/* Score + label */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 28, fontWeight: "900", color: gc.text, lineHeight: 32 }}>{performanceScore}<Text style={{ fontSize: 14, fontWeight: "600", color: gc.text }}>/100</Text></Text>
                    <Text style={{ fontSize: 13, color: gc.text, fontWeight: "600", marginTop: 2 }}>Performance Score</Text>
                    <Text style={{ fontSize: 11, color: gc.text, opacity: 0.75, marginTop: 2 }}>
                      {performanceGrade === "A" ? "Excellent — keep it up" :
                       performanceGrade === "B" ? "Good — a few areas to sharpen" :
                       performanceGrade === "C" ? "Needs work — focus on the drills below" :
                       "Significant gaps — prioritise the top improvement areas"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })()}

          {/* Sticky Section Tab Bar */}
          {videoData?.status === "complete" && (gameStats || strategyOverview || suggestions.length > 0) && (
            <View style={{
              flexDirection: "row",
              marginHorizontal: 24,
              marginBottom: 16,
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}>
              {([
                { key: "stats",        label: "Stats",       icon: "bar-chart" },
                { key: "strategy",     label: "Strategy",    icon: "psychology" },
                { key: "improvements", label: "Drills",      icon: "fitness-center" },
              ] as { key: "stats" | "strategy" | "improvements"; label: string; icon: string }[]).map((tab, ti) => {
                const isActive = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    onPress={() => {
                      setActiveTab(tab.key);
                      const ref = tab.key === "stats" ? statsRef : tab.key === "strategy" ? strategyRef : improvementsRef;
                      ref.current?.measureLayout(
                        scrollViewRef.current as any,
                        (_x, y) => scrollViewRef.current?.scrollTo({ y: y - 8, animated: true }),
                        () => {}
                      );
                    }}
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 10,
                      gap: 5,
                      backgroundColor: isActive ? colors.primary : "transparent",
                      borderRightWidth: ti < 2 ? 1 : 0,
                      borderRightColor: colors.border,
                    }}
                  >
                    <MaterialIcons name={tab.icon as any} size={16} color={isActive ? "#fff" : colors.muted} />
                    <Text style={{ fontSize: 13, fontWeight: "700", color: isActive ? "#fff" : colors.muted }}>{tab.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

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

          {/* Game Stats Panel */}
          {gameStats && (() => {
            // eslint-disable-next-line react-hooks/rules-of-hooks -- ref attached inside IIFE render, not a hook call
            // Normalise all shot stats to the new object format
            const normStats = STAT_ITEMS.map(item => ({
              ...item,
              stat: normaliseShotStat(gameStats[item.key]),
            })).filter(item => item.stat !== null);

            // Shot distribution bar data
            const totalForBar = normStats.reduce((s, i) => s + (i.stat?.count ?? 0), 0);

            return (
              <View ref={statsRef} className="px-6 mb-4">
                {/* Section header */}
                <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, marginBottom: 2 }}>Game Stats</Text>

                {/* Summary line */}
                {(gameStats.totalShots != null || gameStats.totalRallies != null) && (
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
                    {[gameStats.totalShots != null && `~${gameStats.totalShots} shots`, gameStats.totalRallies != null && `~${gameStats.totalRallies} rallies`].filter(Boolean).join(" across ")}
                  </Text>
                )}

                {/* Shot cards grid */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                  {normStats.map(item => {
                    const s = item.stat!;
                    const hasBreakdown = (s.winners != null || s.unforcedErrors != null || s.forcedErrors != null);
                    return (
                      <View
                        key={item.key}
                        style={{
                          backgroundColor: colors.surface,
                          borderRadius: 14,
                          borderWidth: 1,
                          borderColor: colors.border,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          alignItems: "center",
                          minWidth: 88,
                          flex: 1,
                        }}
                      >
                        {/* MaterialIcon */}
                        <MaterialIcons
                          name={item.matIcon as any}
                          size={22}
                          color={colors.primary}
                          style={{ marginBottom: 4 }}
                        />
                        {/* Shot count */}
                        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground, lineHeight: 28 }}>
                          {s.count}
                        </Text>
                        {/* Label */}
                        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 }}>
                          {item.label}
                        </Text>
                        {/* Winner / error breakdown badges */}
                        {hasBreakdown && (
                          <View style={{ flexDirection: "row", gap: 4, marginTop: 7, flexWrap: "wrap", justifyContent: "center" }}>
                            {s.winners != null && s.winners > 0 && (
                              <View style={{ backgroundColor: "rgba(34,197,94,0.15)", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, fontWeight: "700", color: "#16A34A" }}>{s.winners}W</Text>
                              </View>
                            )}
                            {s.unforcedErrors != null && s.unforcedErrors > 0 && (
                              <View style={{ backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, fontWeight: "700", color: "#DC2626" }}>{s.unforcedErrors}UE</Text>
                              </View>
                            )}
                            {s.forcedErrors != null && s.forcedErrors > 0 && (
                              <View style={{ backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, fontWeight: "700", color: "#D97706" }}>{s.forcedErrors}FE</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Shot distribution bar */}
                {totalForBar > 0 && (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Shot Distribution</Text>
                    <View style={{ flexDirection: "row", height: 10, borderRadius: 6, overflow: "hidden", backgroundColor: colors.border }}>
                      {normStats.map((item, idx) => {
                        const pct = ((item.stat?.count ?? 0) / totalForBar) * 100;
                        if (pct < 1) return null;
                        const barColors = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#06B6D4","#EC4899","#84CC16"];
                        return <View key={item.key} style={{ width: `${pct}%` as any, backgroundColor: barColors[idx % barColors.length] }} />;
                      })}
                    </View>
                    {/* Legend */}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                      {normStats.map((item, idx) => {
                        const pct = Math.round(((item.stat?.count ?? 0) / totalForBar) * 100);
                        if (pct < 1) return null;
                        const barColors = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#06B6D4","#EC4899","#84CC16"];
                        return (
                          <View key={item.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: barColors[idx % barColors.length] }} />
                            <Text style={{ fontSize: 11, color: colors.muted }}>{item.label} {pct}%</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Rally stats row */}
                {(gameStats.avgRallyLength != null || gameStats.shortRallyWinPct != null || gameStats.longRallyWinPct != null) && (
                  <View style={{
                    backgroundColor: colors.surface,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                  }}>
                    <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>Rally Stats</Text>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      {gameStats.avgRallyLength != null && (
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>{gameStats.avgRallyLength.toFixed(1)}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", marginTop: 2 }}>Avg shots{"\n"}per rally</Text>
                        </View>
                      )}
                      {gameStats.shortRallyWinPct != null && (
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.success }}>{Math.round(gameStats.shortRallyWinPct)}%</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", marginTop: 2 }}>Short rally{"\n"}win rate</Text>
                        </View>
                      )}
                      {gameStats.longRallyWinPct != null && (
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.primary }}>{Math.round(gameStats.longRallyWinPct)}%</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", marginTop: 2 }}>Long rally{"\n"}win rate</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })()}

          {/* Strategy Overview */}
          {strategyOverview && (() => {
            const sections: { key: keyof typeof strategyOverview; label: string; accent: string; dotColor: string }[] = [
              { key: "strengths",           label: "Strengths",            accent: colors.success, dotColor: "#16A34A" },
              { key: "strategyUsed",        label: "Strategy Used",        accent: colors.primary, dotColor: colors.primary },
              { key: "opponentWeaknesses",  label: "Opponent Weaknesses",  accent: colors.warning, dotColor: "#D97706" },
              { key: "strategicAdjustments",label: "Strategic Adjustments",accent: "#8B5CF6",      dotColor: "#7C3AED" },
            ];
            const visibleSections = sections.filter(s => normStrategyField(strategyOverview[s.key])?.length);

            return (
              <View ref={strategyRef} className="px-6 mb-4">
                <View style={{
                  backgroundColor: colors.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.border,
                  overflow: "hidden",
                }}>
                  {/* Header row with collapse toggle */}
                  <TouchableOpacity
                    onPress={() => setStrategyExpanded(e => !e)}
                    style={{ flexDirection: "row", alignItems: "center", padding: 16, paddingBottom: strategyExpanded ? 12 : 16 }}
                  >
                    <MaterialIcons name="psychology" size={22} color={colors.primary} style={{ marginRight: 8 }} />
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, flex: 1 }}>Strategy Overview</Text>
                    <MaterialIcons
                      name={strategyExpanded ? "keyboard-arrow-up" : "keyboard-arrow-down"}
                      size={22}
                      color={colors.muted}
                    />
                  </TouchableOpacity>

                  {strategyExpanded && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                      {visibleSections.map((section, idx) => {
                        const bullets = normStrategyField(strategyOverview[section.key])!;
                        return (
                          <View key={section.key}>
                            {/* Divider between sections */}
                            {idx > 0 && <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 14 }} />}
                            {/* Section label */}
                            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                              <View style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: section.accent, marginRight: 8 }} />
                              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.foreground, textTransform: "uppercase", letterSpacing: 0.6 }}>
                                {section.label}
                              </Text>
                            </View>
                            {/* Bullet list */}
                            <View style={{ gap: 6, marginBottom: 14 }}>
                              {bullets.map((bullet, bi) => (
                                <View key={bi} style={{ flexDirection: "row", alignItems: "flex-start" }}>
                                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: section.dotColor, marginTop: 7, marginRight: 10, flexShrink: 0 }} />
                                  <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 22, flex: 1 }}>{bullet}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            );
          })()}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <View ref={improvementsRef} className="px-6 pb-8">
              <Text className="text-2xl font-bold text-foreground mb-1">Top {suggestions.length} Improvement Areas</Text>
              <Text className="text-sm text-muted mb-5">
                Ranked by how often each issue appears in the video. Tap a thumbnail to jump to that moment.
              </Text>

              {suggestions.map((suggestion, idx) => {
                const style = getSeverityStyle(suggestion.severity);
                const hasSec = suggestion.frameTimestampSec != null;
                const rankColors = ["#EF4444", "#F59E0B", "#3B82F6", "#8B5CF6"];
                const rankColor = rankColors[idx] ?? "#687076";
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
                    {/* Rank + occurrence count row */}
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                      {/* Rank circle */}
                      <View style={{
                        width: 32, height: 32, borderRadius: 16,
                        backgroundColor: rankColor,
                        alignItems: "center", justifyContent: "center",
                        marginRight: 10,
                      }}>
                        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>#{idx + 1}</Text>
                      </View>
                      {/* Occurrence count badge */}
                      {suggestion.occurrenceCount != null && (
                        <View style={{
                          backgroundColor: rankColor + "22",
                          borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3,
                          borderWidth: 1, borderColor: rankColor + "55",
                          marginRight: 8,
                        }}>
                          <Text style={{ color: rankColor, fontSize: 12, fontWeight: "700" }}>
                            ×{suggestion.occurrenceCount} occurrences
                          </Text>
                        </View>
                      )}
                      {/* Severity badge */}
                      <View style={{ backgroundColor: style.badge, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                        <Text style={{ color: style.badgeText, fontSize: 11, fontWeight: "700" }}>
                          {getSeverityLabel(suggestion.severity)}
                        </Text>
                      </View>
                    </View>

                    {/* Title row */}
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                      <Text style={{ fontSize: 22, marginRight: 8 }}>{getCategoryIcon(suggestion.category)}</Text>
                      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, flex: 1 }}>
                        {suggestion.title}
                      </Text>
                    </View>

                    {/* Impact estimate */}
                    {suggestion.impactEstimate ? (
                      <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 8, backgroundColor: "rgba(59,130,246,0.07)", borderRadius: 8, padding: 8 }}>
                        <MaterialIcons name="trending-up" size={14} color="#3B82F6" style={{ marginTop: 2, marginRight: 6, flexShrink: 0 }} />
                        <Text style={{ fontSize: 12, color: "#3B82F6", lineHeight: 18, flex: 1, fontStyle: "italic" }}>{suggestion.impactEstimate}</Text>
                      </View>
                    ) : null}

                    {/* Description */}
                    <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 21, marginBottom: 8 }}>
                      {suggestion.description}
                    </Text>

                    {/* Category label */}
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {suggestion.category.replace("-", " ")}
                    </Text>

                    {/* Thumbnail clip strip — multiple snapshots if available */}
                    {(() => {
                      const snapshots = suggestion.frameSnapshots?.length
                        ? suggestion.frameSnapshots
                        : hasSec && suggestion.frameUrl && suggestion.frameTimestamp
                          ? [{ url: suggestion.frameUrl, timestampSec: suggestion.frameTimestampSec!, timestamp: suggestion.frameTimestamp }]
                          : [];
                      if (snapshots.length === 0) {
                        return suggestion.frameTimestamp ? (
                          <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center" }}>
                            <Text style={{ fontSize: 12, color: colors.muted }}>⏱ Occurs at {suggestion.frameTimestamp}</Text>
                          </View>
                        ) : null;
                      }
                      return (
                        <View style={{ marginTop: 14 }}>
                          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {snapshots.length > 1 ? `${snapshots.length} examples — tap to loop` : "Example — tap to loop"}
                          </Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                            <View style={{ flexDirection: "row", gap: 10 }}>
                              {snapshots.map((snap, si) => (
                                <ThumbnailClip
                                  key={si}
                                  frameUrl={snap.url}
                                  frameTimestamp={snap.timestamp}
                                  endFrameTimestamp={snap.endTimestamp ?? suggestion.endFrameTimestamp}
                                  timestampSec={snap.timestampSec}
                                  endTimestampSec={snap.endTimestampSec ?? (si === 0 ? suggestion.endFrameTimestampSec : undefined)}
                                  onPress={seekMainVideo}
                                  colors={colors}
                                />
                              ))}
                            </View>
                          </ScrollView>
                        </View>
                      );
                    })()}

                    {/* Drill prescription */}
                    {suggestion.drill ? (
                      <View style={{ marginTop: 14, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                          <MaterialIcons name="fitness-center" size={14} color={colors.success} style={{ marginRight: 6 }} />
                          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.success, textTransform: "uppercase", letterSpacing: 0.5 }}>Drill</Text>
                        </View>
                        <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }}>{suggestion.drill}</Text>
                      </View>
                    ) : null}
                    {/* Thumbs up/down feedback row */}
                    <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                      <Text style={{ fontSize: 11, color: colors.muted, marginRight: 4 }}>Was this accurate?</Text>
                      {(["up", "down"] as const).map((vote) => {
                        const isSelected = feedback[String(idx)] === vote;
                        const iconName = vote === "up" ? "thumb-up" : "thumb-down";
                        const activeColor = vote === "up" ? colors.success : colors.error;
                        return (
                          <TouchableOpacity
                            key={vote}
                            onPress={() => handleFeedback(idx, vote)}
                            style={{
                              flexDirection: "row", alignItems: "center", gap: 4,
                              paddingHorizontal: 10, paddingVertical: 6,
                              borderRadius: 20,
                              borderWidth: 1,
                              borderColor: isSelected ? activeColor : colors.border,
                              backgroundColor: isSelected ? activeColor + "18" : "transparent",
                            }}
                          >
                            <MaterialIcons
                              name={iconName}
                              size={14}
                              color={isSelected ? activeColor : colors.muted}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
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
