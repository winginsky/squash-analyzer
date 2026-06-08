/**
 * Player Detail Screen — /player/[name]
 *
 * Shows a comprehensive view of all analyses for a specific player:
 *   - Overview tab: hero stats, trend chart, most common weaknesses
 *   - Stats tab:    aggregated game stats across all sessions
 *   - Sessions tab: chronological list of all videos for this player
 */
import { useMemo, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { trpc } from "@/lib/trpc";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import Svg, { Polyline, Circle, Line, Text as SvgText } from "react-native-svg";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_H = 180;
const CHART_PAD_LEFT = 44;
const CHART_PAD_RIGHT = 16;
const CHART_PAD_TOP = 16;
const CHART_PAD_BOTTOM = 28;

// ── Helpers ──────────────────────────────────────────────────────────────────
function gradeColor(grade?: string | null): string {
  switch (grade) {
    case "A": return "#22C55E";
    case "B": return "#0a7ea4";
    case "C": return "#F59E0B";
    case "D": return "#EF4444";
    default:  return "#687076";
  }
}

type AnalysisResults = {
  performanceScore?: number;
  performanceGrade?: string;
  gameStats?: {
    forehand?: { total?: number };
    backhand?: { total?: number };
    lob?: { total?: number };
    drop?: { total?: number };
    drive?: { total?: number };
    boast?: { total?: number };
    serve?: { total?: number };
    totalShots?: number;
    totalRallies?: number;
    avgRallyLength?: number;
    shortRallyWinPct?: number;
    longRallyWinPct?: number;
  };
  strategyOverview?: {
    strengths?: string[];
    strategyUsed?: string[];
    opponentWeaknesses?: string[];
    strategicAdjustments?: string[];
  };
  suggestions?: { title: string; description?: string; occurrenceCount?: number }[];
};

type Session = {
  id: number;
  title: string;
  date: Date;
  score: number;
  grade: string | null;
  analysis: AnalysisResults;
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function PlayerDetailScreen() {
  const colors = useColors();
  const { name: rawName } = useLocalSearchParams<{ name: string }>();
  const playerName = rawName === "__none__" ? null : (rawName ? decodeURIComponent(rawName) : null);
  const [activeTab, setActiveTab] = useState<"overview" | "stats" | "sessions">("overview");

  const { data: videosData, isLoading, refetch } = trpc.videos.list.useQuery();
  const deleteVideo = trpc.videos.delete.useMutation({ onSuccess: () => refetch() });
  const handleDeleteFailed = (id: number, title: string) => {
    if (Platform.OS === "web") {
      if (window.confirm(`Delete "${title}"? This cannot be undone.`)) {
        deleteVideo.mutate({ id });
      }
      return;
    }
    Alert.alert(
      "Delete Session",
      `Delete "${title}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteVideo.mutate({ id }) },
      ]
    );
  };

  // Filter to this player's completed sessions
  const sessions: Session[] = useMemo(() => {
    if (!videosData) return [];
    return videosData
      .filter((v) => {
        const matchesPlayer = playerName
          ? v.playerName === playerName
          : !v.playerName;
        if (!matchesPlayer || v.status !== "complete" || !v.analysisResults) return false;
        const r = v.analysisResults as AnalysisResults;
        return typeof r.performanceScore === "number";
      })
      .map((v) => {
        const r = v.analysisResults as AnalysisResults;
        return {
          id: v.id,
          title: v.title,
          date: new Date(v.createdAt),
          score: r.performanceScore!,
          grade: r.performanceGrade ?? null,
          analysis: r,
        };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [videosData, playerName]);

  // All videos for this player (including non-complete)
  const allVideos = useMemo(() => {
    if (!videosData) return [];
    return videosData
      .filter((v) => playerName ? v.playerName === playerName : !v.playerName)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [videosData, playerName]);

  // ── Aggregated stats ──────────────────────────────────────────────────────
  const aggregated = useMemo(() => {
    if (!sessions.length) return null;
    const scores = sessions.map((s) => s.score);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const bestScore = Math.max(...scores);
    const bestGrade = sessions.find((s) => s.score === bestScore)?.grade ?? null;
    const latestSession = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    const improvement = sessions.length >= 2 ? latestSession.score - firstSession.score : null;

    // Aggregate game stats
    const shotKeys = ["forehand", "backhand", "lob", "drop", "drive", "boast", "serve"] as const;
    const shotTotals: Record<string, number> = {};
    let totalShots = 0, totalRallies = 0, rallyCount = 0, avgRallySum = 0;
    sessions.forEach((s) => {
      const gs = s.analysis.gameStats;
      if (!gs) return;
      shotKeys.forEach((k) => {
        const val = (gs as Record<string, { total?: number } | undefined>)[k];
        const t = typeof val === "object" && val ? (val.total ?? 0) : 0;
        shotTotals[k] = (shotTotals[k] ?? 0) + t;
      });
      totalShots += gs.totalShots ?? 0;
      totalRallies += gs.totalRallies ?? 0;
      if (gs.avgRallyLength) { avgRallySum += gs.avgRallyLength; rallyCount++; }
    });
    const avgRallyLength = rallyCount ? +(avgRallySum / rallyCount).toFixed(1) : null;

    // Most common weaknesses across all sessions
    const weaknessMap = new Map<string, number>();
    sessions.forEach((s) => {
      (s.analysis.suggestions ?? []).forEach((sg) => {
        weaknessMap.set(sg.title, (weaknessMap.get(sg.title) ?? 0) + (sg.occurrenceCount ?? 1));
      });
    });
    const topWeaknesses = Array.from(weaknessMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([title, count]) => ({ title, count }));

    return { avgScore, bestScore, bestGrade, improvement, shotTotals, totalShots, totalRallies, avgRallyLength, topWeaknesses, latestSession, firstSession };
  }, [sessions]);

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartInnerW = SCREEN_WIDTH - 32 - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const chartInnerH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const chartPoints = useMemo(() => {
    if (sessions.length < 2) return [];
    return sessions.map((s, i) => {
      const x = CHART_PAD_LEFT + (i / (sessions.length - 1)) * chartInnerW;
      const y = CHART_PAD_TOP + chartInnerH * (1 - s.score / 100);
      return { x, y, session: s };
    });
  }, [sessions, chartInnerW, chartInnerH]);
  const polylinePoints = chartPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const gridLines = [25, 50, 75, 100];

  // ── Avatar helpers ────────────────────────────────────────────────────────
  const avatarPalette = ["#0a7ea4", "#7C3AED", "#DB2777", "#D97706", "#059669", "#DC2626", "#2563EB"];
  const avatarColor = playerName
    ? avatarPalette[Math.abs([...playerName].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % avatarPalette.length]
    : colors.muted;
  const initials = playerName
    ? playerName.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")
    : "?";

  // ── Shot distribution ─────────────────────────────────────────────────────
  const shotKeys = ["forehand", "backhand", "lob", "drop", "drive", "boast", "serve"] as const;
  const shotColors: Record<string, string> = {
    forehand: "#0a7ea4", backhand: "#7C3AED", lob: "#059669",
    drop: "#D97706", drive: "#DB2777", boast: "#DC2626", serve: "#687076",
  };

  if (isLoading) {
    return (
      <ScreenContainer>
        <ActivityIndicator color={colors.primary} style={{ flex: 1, marginTop: 80 }} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* ── Header ── */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border, gap: 12 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <Text style={{ fontSize: 24, color: colors.primary }}>‹</Text>
        </TouchableOpacity>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: avatarColor + "22", borderWidth: 2, borderColor: avatarColor, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: avatarColor }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
            {playerName ?? "Unassigned Videos"}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {allVideos.length} session{allVideos.length !== 1 ? "s" : ""}
            {sessions.length > 0 ? ` · ${sessions.length} analysed` : ""}
          </Text>
        </View>
        {aggregated?.bestGrade && (
          <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: gradeColor(aggregated.bestGrade), alignItems: "center", justifyContent: "center", backgroundColor: gradeColor(aggregated.bestGrade) + "18" }}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: gradeColor(aggregated.bestGrade) }}>{aggregated.bestGrade}</Text>
          </View>
        )}
      </View>

      {/* ── Tab bar ── */}
      <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
        {(["overview", "stats", "sessions"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={{ flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: activeTab === tab ? colors.primary : "transparent" }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: activeTab === tab ? colors.primary : colors.muted, textTransform: "capitalize" }}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ══════════════════════════════════════════════════════════════
            OVERVIEW TAB
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && (
          <>
            {/* Hero stats row */}
            {aggregated ? (
              <>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {/* Avg Score */}
                  <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: "center" }}>
                    <Text style={{ fontSize: 32, fontWeight: "800", color: colors.primary }}>{aggregated.avgScore}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Avg Score</Text>
                  </View>
                  {/* Best Score */}
                  <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: "center" }}>
                    <Text style={{ fontSize: 32, fontWeight: "800", color: gradeColor(aggregated.bestGrade) }}>{aggregated.bestScore}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Best Score</Text>
                  </View>
                  {/* Improvement */}
                  <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: "center" }}>
                    {aggregated.improvement !== null ? (
                      <>
                        <Text style={{ fontSize: 32, fontWeight: "800", color: aggregated.improvement >= 0 ? "#22C55E" : "#EF4444" }}>
                          {aggregated.improvement >= 0 ? "+" : ""}{aggregated.improvement}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Improvement</Text>
                      </>
                    ) : (
                      <>
                        <Text style={{ fontSize: 32, fontWeight: "800", color: colors.muted }}>—</Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Improvement</Text>
                      </>
                    )}
                  </View>
                </View>

                {/* Trend chart */}
                {sessions.length >= 2 && (
                  <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Performance Trend</Text>
                    <Svg width={SCREEN_WIDTH - 64} height={CHART_H}>
                      {/* Grid lines */}
                      {gridLines.map((val) => {
                        const y = CHART_PAD_TOP + chartInnerH * (1 - val / 100);
                        return (
                          <Line key={val} x1={CHART_PAD_LEFT} y1={y} x2={CHART_PAD_LEFT + chartInnerW} y2={y} stroke={colors.border} strokeWidth={0.5} />
                        );
                      })}
                      {/* Y-axis labels */}
                      {gridLines.map((val) => {
                        const y = CHART_PAD_TOP + chartInnerH * (1 - val / 100);
                        return (
                          <SvgText key={`lbl-${val}`} x={CHART_PAD_LEFT - 6} y={y + 4} fontSize={9} fill={colors.muted} textAnchor="end">{val}</SvgText>
                        );
                      })}
                      {/* Trend line */}
                      <Polyline points={polylinePoints} fill="none" stroke={colors.primary} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                      {/* Data points */}
                      {chartPoints.map((p, i) => (
                        <Circle key={i} cx={p.x} cy={p.y} r={4} fill={gradeColor(p.session.grade)} stroke={colors.background} strokeWidth={1.5} />
                      ))}
                      {/* X-axis date labels for first and last */}
                      {chartPoints.length >= 2 && (
                        <>
                          <SvgText x={chartPoints[0].x} y={CHART_H - 4} fontSize={9} fill={colors.muted} textAnchor="middle">
                            {chartPoints[0].session.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </SvgText>
                          <SvgText x={chartPoints[chartPoints.length - 1].x} y={CHART_H - 4} fontSize={9} fill={colors.muted} textAnchor="middle">
                            {chartPoints[chartPoints.length - 1].session.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </SvgText>
                        </>
                      )}
                    </Svg>
                    <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", marginTop: 4 }}>
                      {sessions.length} sessions · Dots coloured by grade
                    </Text>
                  </View>
                )}

                {/* Top weaknesses */}
                {aggregated.topWeaknesses.length > 0 && (
                  <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Most Common Areas to Improve</Text>
                    {aggregated.topWeaknesses.map((w, i) => (
                      <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: i < aggregated.topWeaknesses.length - 1 ? 10 : 0 }}>
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary + "22", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>{i + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{w.title}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>Flagged {w.count} time{w.count !== 1 ? "s" : ""} across sessions</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Latest session strengths */}
                {aggregated.latestSession.analysis.strategyOverview?.strengths?.length ? (
                  <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>Latest Session Strengths</Text>
                    {aggregated.latestSession.analysis.strategyOverview.strengths.map((s, i) => (
                      <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                        <Text style={{ color: "#22C55E", fontSize: 13 }}>✓</Text>
                        <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>{s}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 48, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>📊</Text>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>No completed analyses yet</Text>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", paddingHorizontal: 24 }}>Upload and analyse a video for this player to see their stats here.</Text>
              </View>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STATS TAB
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === "stats" && (
          <>
            {aggregated ? (
              <>
                {/* Summary stats */}
                <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                  {[
                    { label: "Total Shots", value: aggregated.totalShots || "—" },
                    { label: "Total Rallies", value: aggregated.totalRallies || "—" },
                    { label: "Avg Rally Len.", value: aggregated.avgRallyLength ?? "—" },
                    { label: "Sessions", value: sessions.length },
                  ].map((stat) => (
                    <View key={stat.label} style={{ flex: 1, minWidth: "45%", backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: "center" }}>
                      <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>{stat.value}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, textAlign: "center" }}>{stat.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Shot distribution */}
                {Object.values(aggregated.shotTotals).some((v) => v > 0) && (
                  <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 14 }}>Shot Distribution (all sessions)</Text>
                    {(() => {
                      const total = Object.values(aggregated.shotTotals).reduce((a, b) => a + b, 0);
                      if (!total) return <Text style={{ color: colors.muted, fontSize: 13 }}>No shot data available</Text>;
                      return shotKeys.map((k) => {
                        const count = aggregated.shotTotals[k] ?? 0;
                        const pct = total ? (count / total) * 100 : 0;
                        if (!count) return null;
                        return (
                          <View key={k} style={{ marginBottom: 10 }}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground, textTransform: "capitalize" }}>{k}</Text>
                              <Text style={{ fontSize: 12, color: colors.muted }}>{count} ({pct.toFixed(0)}%)</Text>
                            </View>
                            <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                              <View style={{ height: 8, width: `${pct}%`, backgroundColor: shotColors[k], borderRadius: 4 }} />
                            </View>
                          </View>
                        );
                      });
                    })()}
                  </View>
                )}

                {/* Score distribution across sessions */}
                <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Score History</Text>
                  {sessions.map((s, i) => (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => router.push(`/video/${s.id}` as any)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: i < sessions.length - 1 ? 10 : 0 }}
                      activeOpacity={0.7}
                    >
                      <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: gradeColor(s.grade), alignItems: "center", justifyContent: "center", backgroundColor: gradeColor(s.grade) + "18" }}>
                        <Text style={{ fontSize: 11, fontWeight: "800", color: gradeColor(s.grade) }}>{s.grade ?? "?"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{s.title}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>{s.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Text>
                      </View>
                      <Text style={{ fontSize: 18, fontWeight: "800", color: gradeColor(s.grade) }}>{s.score}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 48, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>📊</Text>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>No stats yet</Text>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", paddingHorizontal: 24 }}>Complete at least one analysis to see aggregated stats.</Text>
              </View>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════
            SESSIONS TAB
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === "sessions" && (
          <>
            {allVideos.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 48, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>🎾</Text>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>No sessions yet</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {allVideos.map((v) => {
                  const r = v.analysisResults as AnalysisResults | null;
                  const score = r?.performanceScore;
                  const grade = r?.performanceGrade ?? null;
                  const topSuggestion = r?.suggestions?.[0]?.title;
                  const statusColor = v.status === "complete" ? "#22C55E" : v.status === "failed" ? "#EF4444" : v.status === "downloading" ? "#0a7ea4" : "#F59E0B";
                  return (
                    <View key={v.id}>
                      <TouchableOpacity
                        onPress={v.status === "failed" ? undefined : () => router.push(`/video/${v.id}` as any)}
                        style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: v.status === "failed" ? "#EF444466" : colors.border, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}
                        activeOpacity={v.status === "failed" ? 1 : 0.75}
                      >
                        {/* Grade or status indicator */}
                        <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: grade ? gradeColor(grade) : statusColor, alignItems: "center", justifyContent: "center", backgroundColor: (grade ? gradeColor(grade) : statusColor) + "18" }}>
                          {grade ? (
                            <Text style={{ fontSize: 14, fontWeight: "800", color: gradeColor(grade) }}>{grade}</Text>
                          ) : (
                            <Text style={{ fontSize: 9, fontWeight: "700", color: statusColor, textTransform: "uppercase" }}>{v.status === "downloading" ? "↓" : v.status === "analyzing" ? "…" : v.status === "failed" ? "✗" : "?"}</Text>
                          )}
                        </View>
                        {/* Info */}
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{v.title}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>
                            {new Date(v.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                            {v.status === "downloading" ? " · Downloading…" : v.status === "analyzing" ? " · Analysing…" : v.status === "failed" ? " · Failed" : ""}
                          </Text>
                          {topSuggestion && (
                            <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>Top: {topSuggestion}</Text>
                          )}
                        </View>
                        {/* Score chevron for non-failed */}
                        {v.status !== "failed" && (
                          <>
                            {typeof score === "number" && (
                              <Text style={{ fontSize: 20, fontWeight: "800", color: gradeColor(grade) }}>{score}</Text>
                            )}
                            <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      {v.status === "failed" && (
                        <Pressable
                          onPress={() => handleDeleteFailed(v.id, v.title)}
                          style={({ pressed }) => ({
                            marginTop: 4,
                            paddingVertical: 9,
                            borderRadius: 9,
                            backgroundColor: pressed ? "#EF444433" : "#EF444418",
                            borderWidth: 1,
                            borderColor: "#EF444466",
                            alignItems: "center",
                          })}
                        >
                          <Text style={{ fontSize: 13, fontWeight: "600", color: "#EF4444" }}>🗑 Delete Session</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

      </ScrollView>
    </ScreenContainer>
  );
}
