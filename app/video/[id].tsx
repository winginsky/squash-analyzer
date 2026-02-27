import { useState, useMemo } from "react";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";
import { ScrollView, Text, View, TouchableOpacity } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

type Suggestion = {
  id: string;
  category: "technique" | "positioning" | "shot-selection" | "movement";
  title: string;
  description: string;
  severity: "success" | "warning" | "error";
};

const MOCK_SUGGESTIONS: Suggestion[] = [
  {
    id: "1",
    category: "technique",
    title: "Racket Preparation",
    description: "Your racket preparation is generally good, but try to get your racket back earlier when anticipating a backhand shot. This will give you more time to execute a controlled swing.",
    severity: "warning",
  },
  {
    id: "2",
    category: "positioning",
    title: "Court Position",
    description: "Excellent T-position recovery after most shots. You're consistently returning to the center of the court, which gives you optimal coverage.",
    severity: "success",
  },
  {
    id: "3",
    category: "shot-selection",
    title: "Drop Shot Timing",
    description: "Consider using more drop shots when your opponent is behind you. You had several opportunities where a well-placed drop would have been very effective.",
    severity: "warning",
  },
  {
    id: "4",
    category: "movement",
    title: "Footwork Pattern",
    description: "Your footwork to the front of the court is strong, but work on your movement to the back corners. Try to use more explosive push-offs from your back leg.",
    severity: "error",
  },
];

const getCategoryIcon = (category: string) => {
  switch (category) {
    case "technique":
      return "🎯";
    case "positioning":
      return "📍";
    case "shot-selection":
      return "🎾";
    case "movement":
      return "👟";
    default:
      return "💡";
  }
};

const getCategoryColor = (severity: string) => {
  switch (severity) {
    case "success":
      return "border-success bg-success/10";
    case "warning":
      return "border-warning bg-warning/10";
    case "error":
      return "border-error bg-error/10";
    default:
      return "border-border bg-surface";
  }
};

export default function VideoDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams();
  const videoId = parseInt(id as string, 10);
  
  const { data: videoData, isLoading } = trpc.videos.get.useQuery({ id: videoId });
  
  const videoUrl = videoData?.videoUrl || "";
  const suggestions = useMemo(() => {
    if (!videoData?.analysisResults) return MOCK_SUGGESTIONS;
    const results = videoData.analysisResults as any;
    return results.suggestions || MOCK_SUGGESTIONS;
  }, [videoData]);

  const player = useVideoPlayer(videoUrl, (player) => {
    player.loop = false;
  });

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="max-w-5xl mx-auto w-full flex-1">
      <ScrollView className="flex-1">
        {/* Header */}
        <View className="px-6 pt-4 pb-2 flex-row items-center justify-between">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center -ml-2"
          >
            <Text className="text-foreground text-2xl">←</Text>
          </TouchableOpacity>
          <Text className="text-xl font-bold text-foreground flex-1 text-center">
            Video Analysis
          </Text>
          <View className="w-10" />
        </View>

        {/* Video Player */}
        <View className="px-6 mb-4">
          <VideoView
            player={player}
            style={{
              width: "100%",
              aspectRatio: 16 / 9,
              borderRadius: 16,
              backgroundColor: colors.surface,
              maxHeight: Platform.OS === "web" ? 600 : undefined,
            }}
            allowsFullscreen
            nativeControls
          />
        </View>

        {/* Player Information */}
        {videoData && (videoData.playerName || videoData.playerDescription) && (
          <View className="px-6 mb-4">
            <View className="bg-surface rounded-xl p-4 border border-border">
              <View className="flex-row items-center mb-2">
                <View className="w-8 h-8 bg-primary/10 rounded-full items-center justify-center mr-3">
                  <Text className="text-primary text-base">🎾</Text>
                </View>
                <Text className="text-base font-semibold text-foreground">
                  Analyzing Player
                </Text>
              </View>
              {videoData.playerName && (
                <Text className="text-foreground font-medium mb-1">
                  {videoData.playerName}
                </Text>
              )}
              {videoData.playerDescription && (
                <Text className="text-sm text-muted">
                  {videoData.playerDescription}
                </Text>
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
                  <Text className="text-success font-semibold text-base">
                    Analysis Complete
                  </Text>
                  <Text className="text-success/80 text-sm">
                    {suggestions.length} suggestions generated
                  </Text>
                </View>
              </View>
            )}
            {videoData.status === "analyzing" && (
              <View className="bg-warning/20 rounded-xl p-4 flex-row items-center">
                <View className="w-10 h-10 bg-warning/30 rounded-full items-center justify-center mr-3">
                  <Text className="text-warning text-xl">⏳</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-warning font-semibold text-base">
                    Analyzing Video...
                  </Text>
                  <Text className="text-warning/80 text-sm">
                    This may take a few minutes
                  </Text>
                </View>
              </View>
            )}
            {videoData.status === "failed" && (
              <View className="bg-error/20 rounded-xl p-4 flex-row items-center">
                <View className="w-10 h-10 bg-error/30 rounded-full items-center justify-center mr-3">
                  <Text className="text-error text-xl">✕</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-error font-semibold text-base">
                    Analysis Failed
                  </Text>
                  <Text className="text-error/80 text-sm">
                    {videoData.errorMessage || "Please try again"}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Suggestions */}
        <View className="px-6 pb-6">
          <Text className="text-2xl font-bold text-foreground mb-4">
            AI Suggestions
          </Text>

          {suggestions.map((suggestion: Suggestion) => (
            <View
              key={suggestion.id}
              className={`mb-4 rounded-2xl border-l-4 p-4 ${getCategoryColor(suggestion.severity)}`}
            >
              <View className="flex-row items-center mb-2">
                <Text className="text-2xl mr-2">
                  {getCategoryIcon(suggestion.category)}
                </Text>
                <Text className="text-lg font-semibold text-foreground flex-1">
                  {suggestion.title}
                </Text>
              </View>
              <Text className="text-sm text-muted leading-relaxed">
                {suggestion.description}
              </Text>
              <View className="mt-2">
                <Text className="text-xs font-medium text-muted uppercase">
                  {suggestion.category.replace("-", " ")}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      </View>
    </ScreenContainer>
  );
}
