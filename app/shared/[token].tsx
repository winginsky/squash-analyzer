/**
 * Public shared-video screen — accessible without login via a share token.
 * Route: /shared/[token]
 */
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { trpc } from "@/lib/trpc";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

type Suggestion = {
  title: string;
  description?: string;
  drill?: string;
  timestamp?: string;
  frameUrl?: string;
};

type AnalysisResults = {
  coachComment?: string;
  strategyOverview?: {
    strengths?: string[];
    strategyUsed?: string[];
    opponentWeaknesses?: string[];
    strategicAdjustments?: string[];
  };
  suggestions?: Suggestion[];
};

export default function SharedVideoScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const colors = useColors();

  const { data: video, isLoading, error } = trpc.videos.getByShareToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  if (isLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={{ marginTop: 12, fontSize: 14, color: colors.muted }}>Loading shared video…</Text>
      </ScreenContainer>
    );
  }

  if (error || !video) {
    return (
      <ScreenContainer className="items-center justify-center px-8">
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🔒</Text>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, marginBottom: 8, textAlign: "center" }}>
          Link Not Found
        </Text>
        <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginBottom: 24 }}>
          This shared link is invalid or has expired.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace("/")}
          style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.background }}>Go Home</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  const results = video.analysisResults as AnalysisResults | null;
  const suggestions = results?.suggestions ?? [];
  const strategy = results?.strategyOverview;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ maxWidth: 800, width: "100%", alignSelf: "center", padding: 24 }}>
          {/* Header */}
          <View style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <View style={{ backgroundColor: colors.primary + "20", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Shared Analysis</Text>
              </View>
            </View>
            <Text style={{ fontSize: 26, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
              {video.title}
            </Text>
            {video.playerName ? (
              <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 2 }}>Player: {video.playerName}</Text>
            ) : null}
            <Text style={{ fontSize: 13, color: colors.muted }}>
              {new Date(video.createdAt).toLocaleDateString()}
            </Text>
          </View>

          {/* Status banner */}
          {video.status !== "complete" && (
            <View style={{
              backgroundColor: video.status === "failed" ? colors.error + "15" : colors.warning + "15",
              borderRadius: 12,
              padding: 16,
              marginTop: 16,
              borderWidth: 1,
              borderColor: video.status === "failed" ? colors.error + "40" : colors.warning + "40",
            }}>
              <Text style={{ fontSize: 14, color: video.status === "failed" ? colors.error : colors.warning, fontWeight: "600" }}>
                {video.status === "failed" ? "Analysis Failed" : "Analysis In Progress…"}
              </Text>
              {video.status === "failed" && video.errorMessage ? (
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>{video.errorMessage}</Text>
              ) : null}
            </View>
          )}

          {/* Coach comment */}
          {results?.coachComment ? (
            <View style={{
              backgroundColor: colors.primary + "10",
              borderRadius: 14,
              padding: 16,
              marginTop: 20,
              borderLeftWidth: 4,
              borderLeftColor: colors.primary,
            }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary, marginBottom: 6 }}>AI Coach Summary</Text>
              <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 22 }}>{results.coachComment}</Text>
            </View>
          ) : null}

          {/* Strategy overview */}
          {strategy && (
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: 18,
              marginTop: 20,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 14 }}>
                Strategy Overview
              </Text>
              {strategy.strengths?.length ? (
                <StrategySection title="Strengths" items={strategy.strengths} color={colors.success} colors={colors} />
              ) : null}
              {strategy.strategyUsed?.length ? (
                <StrategySection title="Strategy Used" items={strategy.strategyUsed} color={colors.primary} colors={colors} />
              ) : null}
              {strategy.opponentWeaknesses?.length ? (
                <StrategySection title="Opponent Weaknesses" items={strategy.opponentWeaknesses} color={colors.warning} colors={colors} />
              ) : null}
              {strategy.strategicAdjustments?.length ? (
                <StrategySection title="Adjustments to Make" items={strategy.strategicAdjustments} color={colors.error} colors={colors} />
              ) : null}
            </View>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <View style={{ marginTop: 24 }}>
              <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, marginBottom: 14 }}>
                Coaching Suggestions ({suggestions.length})
              </Text>
              {suggestions.map((s, i) => (
                <View
                  key={i}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 16,
                    padding: 16,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                    <View style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: colors.primary,
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.background }}>{i + 1}</Text>
                    </View>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, flex: 1, lineHeight: 22 }}>
                      {s.title}
                    </Text>
                  </View>
                  {s.description ? (
                    <Text style={{ fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: s.drill ? 8 : 0 }}>
                      {s.description}
                    </Text>
                  ) : null}
                  {s.drill ? (
                    <View style={{ backgroundColor: colors.primary + "10", borderRadius: 10, padding: 10, marginTop: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary, marginBottom: 4 }}>Drill</Text>
                      <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 18 }}>{s.drill}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* Footer CTA */}
          <View style={{ marginTop: 32, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
              Want to analyze your own squash videos?
            </Text>
            <TouchableOpacity
              onPress={() => router.replace("/")}
              style={{ backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 }}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.background }}>Try Squash Analyzer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function StrategySection({
  title,
  items,
  color,
  colors,
}: {
  title: string;
  items: string[];
  color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color, marginBottom: 6 }}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
          <Text style={{ fontSize: 14, color }}>•</Text>
          <Text style={{ fontSize: 14, color: colors.foreground, flex: 1, lineHeight: 20 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}
