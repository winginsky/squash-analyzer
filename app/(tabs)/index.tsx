import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { FlatList, Text, View, TouchableOpacity, Pressable, RefreshControl, Platform } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

type VideoAnalysis = {
  id: string;
  title: string;
  date: string;
  status: "analyzing" | "complete" | "failed";
  thumbnailUrl?: string;
};

export default function HomeScreen() {
  const colors = useColors();
  const { data: videosData, isLoading, refetch } = trpc.videos.list.useQuery();
  const [refreshing, setRefreshing] = useState(false);

  // Map database records to UI format
  const videos: VideoAnalysis[] = (videosData || []).map((v) => ({
    id: v.id.toString(),
    title: v.title,
    date: new Date(v.createdAt).toLocaleDateString(),
    status: v.status === "complete" ? "complete" : v.status === "failed" ? "failed" : "analyzing",
    thumbnailUrl: v.thumbnailUrl || undefined,
  }));

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleUpload = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push("/upload");
  };

  const handleVideoPress = (videoId: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push(`/video/${videoId}` as any);
  };

  const renderVideoCard = ({ item }: { item: VideoAnalysis }) => (
    <Pressable
      onPress={() => handleVideoPress(item.id)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
      })}
      className="mb-4 flex-1"
    >
      <View className="bg-surface rounded-2xl p-4 border border-border">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-1">
            <Text className="text-lg font-semibold text-foreground">
              {item.title}
            </Text>
            {(videosData?.find(v => v.id.toString() === item.id)?.playerName) && (
              <Text className="text-sm text-muted mt-0.5">
                Player: {videosData.find(v => v.id.toString() === item.id)?.playerName}
              </Text>
            )}
          </View>
          <View
            className={`px-3 py-1 rounded-full ${
              item.status === "complete"
                ? "bg-success/20"
                : item.status === "analyzing"
                ? "bg-warning/20"
                : "bg-error/20"
            }`}
          >
            <Text
              className={`text-xs font-medium ${
                item.status === "complete"
                  ? "text-success"
                  : item.status === "analyzing"
                  ? "text-warning"
                  : "text-error"
              }`}
            >
              {item.status === "complete"
                ? "Complete"
                : item.status === "analyzing"
                ? "Analyzing..."
                : "Failed"}
            </Text>
          </View>
        </View>
        <Text className="text-sm text-muted">{item.date}</Text>
      </View>
    </Pressable>
  );

  const renderEmptyState = () => (
    <View className="flex-1 items-center justify-center px-6">
      <View className="w-24 h-24 bg-primary/10 rounded-full items-center justify-center mb-4">
        <IconSymbol name="paperplane.fill" size={40} color={colors.primary} />
      </View>
      <Text className="text-2xl font-bold text-foreground mb-2 text-center">
        No Videos Yet
      </Text>
      <Text className="text-base text-muted text-center mb-6">
        Upload your first squash game video to get AI-powered analysis and suggestions
      </Text>
      <Pressable
        onPress={handleUpload}
        style={({ pressed }) => ({
          transform: [{ scale: pressed ? 0.97 : 1 }],
          opacity: pressed ? 0.9 : 1,
        })}
        className="bg-primary px-6 py-3 rounded-full"
      >
        <Text className="text-background font-semibold text-base">
          Upload Video
        </Text>
      </Pressable>
    </View>
  );

  return (
    <ScreenContainer>
      <View className="flex-1 max-w-7xl mx-auto w-full">
        {/* Header */}
        <View className="px-6 pt-4 pb-2 flex-row items-center justify-between">
          <View>
            <Text className="text-3xl font-bold text-foreground">
              My Videos
            </Text>
            <Text className="text-base text-muted mt-1">
              Upload and analyze your squash games
            </Text>
          </View>
          <Pressable
            onPress={handleUpload}
            style={({ pressed }) => ({
              transform: Platform.OS !== "web" ? [{ scale: pressed ? 0.97 : 1 }] : undefined,
              opacity: pressed ? 0.9 : 1,
            })}
            className="bg-primary px-6 py-3 rounded-full flex-row items-center"
          >
            <Text className="text-background text-xl font-bold mr-2">+</Text>
            <Text className="text-background font-semibold text-base">
              Upload Video
            </Text>
          </Pressable>
        </View>

        {/* Video List */}
        <FlatList
          data={videos}
          renderItem={renderVideoCard}
          keyExtractor={(item) => item.id}
          key={Platform.OS === "web" ? "grid" : "list"}
          numColumns={Platform.OS === "web" ? 2 : 1}
          columnWrapperStyle={Platform.OS === "web" ? { gap: 16 } : undefined}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 24,
          }}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        />
      </View>
    </ScreenContainer>
  );
}
