import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { FlatList, Text, View, TouchableOpacity, Pressable, RefreshControl } from "react-native";
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/upload");
  };

  const handleVideoPress = (videoId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/video/${videoId}` as any);
  };

  const renderVideoCard = ({ item }: { item: VideoAnalysis }) => (
    <Pressable
      onPress={() => handleVideoPress(item.id)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
      })}
      className="mb-4"
    >
      <View className="bg-surface rounded-2xl p-4 border border-border">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-lg font-semibold text-foreground flex-1">
            {item.title}
          </Text>
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
      <View className="flex-1">
        {/* Header */}
        <View className="px-6 pt-4 pb-2 flex-row items-center justify-between">
          <Text className="text-3xl font-bold text-foreground">
            My Videos
          </Text>
          <Pressable
            onPress={handleUpload}
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.97 : 1 }],
              opacity: pressed ? 0.9 : 1,
            })}
            className="bg-primary w-12 h-12 rounded-full items-center justify-center"
          >
            <Text className="text-background text-2xl font-bold">+</Text>
          </Pressable>
        </View>

        {/* Video List */}
        <FlatList
          data={videos}
          renderItem={renderVideoCard}
          keyExtractor={(item) => item.id}
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
