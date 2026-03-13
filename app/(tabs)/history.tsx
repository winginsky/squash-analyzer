import { useMemo } from "react";
import { ScrollView, Text, View, TouchableOpacity, Dimensions } from "react-native";
import { router } from "expo-router";
import { trpc } from "@/lib/trpc";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import Svg, { Polyline, Circle, Line, Text as SvgText } from "react-native-svg";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_H = 180;
const CHART_PAD_LEFT = 40;
const CHART_PAD_RIGHT = 16;
const CHART_PAD_TOP = 16;
const CHART_PAD_BOTTOM = 28;

function gradeColor(grade: string | null | undefined): string {
  switch (grade) {
    case "A": return "#22C55E";
    case "B": return "#0a7ea4";
    case "C": return "#F59E0B";
    case "D": return "#EF4444";
    default:  return "#687076";
  }
}

function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr as string);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface SessionPoint {
  id: number;
  title: string;
  playerName: string | null;
  score: number;
  grade: string | null;
  date: string | Date | null;
}

export default function HistoryScreen() {
  const colors = useColors();
  const { data: videos, isLoading } = trpc.videos.list.useQuery();

  // Extract sessions with performance scores, sorted oldest → newest
  const sessions: SessionPoint[] = useMemo(() => {
    if (!videos) return [];
    return videos
      .filter((v) => {
        if (v.status !== "complete" || !v.analysisResults) return false;
        const r = v.analysisResults as { performanceScore?: number };
        return typeof r.performanceScore === "number";
      })
      .map((v) => {
        const r = v.analysisResults as { performanceScore?: number; performanceGrade?: string };
        return {
          id: v.id,
          title: v.title,
          playerName: v.playerName ?? null,
          score: r.performanceScore!,
          grade: r.performanceGrade ?? null,
          date: v.createdAt ?? null,
        };
      })
      .sort((a, b) => new Date(a.date as unknown as string).getTime() - new Date(b.date as unknown as string).getTime());
  }, [videos]);

  const chartWidth = SCREEN_WIDTH - 32; // 16px padding each side
  const innerW = chartWidth - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const innerH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;

  // Map sessions to chart coordinates
  const points = useMemo(() => {
    if (sessions.length === 0) return [];
    if (sessions.length === 1) {
      return [{ x: CHART_PAD_LEFT + innerW / 2, y: CHART_PAD_TOP + innerH * (1 - sessions[0].score / 100), session: sessions[0] }];
    }
    return sessions.map((s, i) => ({
      x: CHART_PAD_LEFT + (i / (sessions.length - 1)) * innerW,
      y: CHART_PAD_TOP + innerH * (1 - s.score / 100),
      session: s,
    }));
  }, [sessions, innerW, innerH]);

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Y-axis grid lines at 0, 25, 50, 75, 100
  const gridLines = [0, 25, 50, 75, 100];

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>Progress</Text>
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 2 }}>
            Performance score across all sessions
          </Text>
        </View>

        {isLoading ? (
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <Text style={{ color: colors.muted, fontSize: 15 }}>Loading sessions…</Text>
          </View>
        ) : sessions.length === 0 ? (
          /* Empty state */
          <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 32 }}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>📈</Text>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, textAlign: "center", marginBottom: 8 }}>
              No scored sessions yet
            </Text>
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 22 }}>
              Upload and analyze a squash video to start tracking your performance score over time.
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/")}
              style={{ marginTop: 24, backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 }}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Upload a Video</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Summary row */}
            <View style={{ flexDirection: "row", paddingHorizontal: 20, gap: 12, marginBottom: 16 }}>
              {[
                { label: "Sessions", value: String(sessions.length) },
                { label: "Latest Score", value: String(sessions[sessions.length - 1].score) },
                { label: "Best Score", value: String(Math.max(...sessions.map((s) => s.score))) },
                {
                  label: "Trend",
                  value: sessions.length >= 2
                    ? sessions[sessions.length - 1].score > sessions[sessions.length - 2].score
                      ? "↑ Up"
                      : sessions[sessions.length - 1].score < sessions[sessions.length - 2].score
                        ? "↓ Down"
                        : "→ Flat"
                    : "—",
                },
              ].map((stat) => (
                <View
                  key={stat.label}
                  style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                >
                  <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>{stat.value}</Text>
                  <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2, textAlign: "center" }}>{stat.label}</Text>
                </View>
              ))}
            </View>

            {/* Line chart */}
            <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 8, marginBottom: 20 }}>
              <Svg width={chartWidth} height={CHART_H}>
                {/* Grid lines */}
                {gridLines.map((g) => {
                  const y = CHART_PAD_TOP + innerH * (1 - g / 100);
                  return (
                    <Line
                      key={g}
                      x1={CHART_PAD_LEFT}
                      y1={y}
                      x2={CHART_PAD_LEFT + innerW}
                      y2={y}
                      stroke={colors.border}
                      strokeWidth={1}
                      strokeDasharray={g === 0 || g === 100 ? undefined : "4,4"}
                    />
                  );
                })}
                {/* Y-axis labels */}
                {gridLines.map((g) => {
                  const y = CHART_PAD_TOP + innerH * (1 - g / 100);
                  return (
                    <SvgText
                      key={`label-${g}`}
                      x={CHART_PAD_LEFT - 6}
                      y={y + 4}
                      fontSize={9}
                      fill={colors.muted}
                      textAnchor="end"
                    >
                      {g}
                    </SvgText>
                  );
                })}
                {/* Polyline */}
                {points.length > 1 && (
                  <Polyline
                    points={polylinePoints}
                    fill="none"
                    stroke={colors.primary}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {/* Data points */}
                {points.map((p, i) => (
                  <Circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={5}
                    fill={gradeColor(p.session.grade)}
                    stroke={colors.background}
                    strokeWidth={2}
                  />
                ))}
                {/* X-axis date labels */}
                {points.map((p, i) => (
                  <SvgText
                    key={`date-${i}`}
                    x={p.x}
                    y={CHART_H - 6}
                    fontSize={9}
                    fill={colors.muted}
                    textAnchor="middle"
                  >
                    {formatDate(p.session.date)}
                  </SvgText>
                ))}
              </Svg>
              {/* Legend */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 8, paddingBottom: 4 }}>
                {(["A", "B", "C", "D"] as const).map((g) => (
                  <View key={g} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: gradeColor(g) }} />
                    <Text style={{ fontSize: 10, color: colors.muted }}>Grade {g}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Session cards */}
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, paddingHorizontal: 20, marginBottom: 10 }}>
              All Sessions
            </Text>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {[...sessions].reverse().map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => router.push(`/video/${s.id}` as any)}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                  }}
                >
                  {/* Grade ring */}
                  <View style={{
                    width: 48, height: 48, borderRadius: 24,
                    borderWidth: 3, borderColor: gradeColor(s.grade),
                    alignItems: "center", justifyContent: "center",
                    backgroundColor: gradeColor(s.grade) + "18",
                  }}>
                    <Text style={{ fontSize: 18, fontWeight: "800", color: gradeColor(s.grade) }}>{s.grade ?? "?"}</Text>
                  </View>
                  {/* Info */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>{s.title}</Text>
                    {s.playerName ? (
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>Player: {s.playerName}</Text>
                    ) : null}
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{formatDate(s.date)}</Text>
                  </View>
                  {/* Score */}
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 22, fontWeight: "800", color: gradeColor(s.grade) }}>{s.score}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>/ 100</Text>
                  </View>
                  {/* Chevron */}
                  <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
