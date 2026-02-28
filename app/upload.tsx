import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Text, View, TouchableOpacity, ActivityIndicator, TextInput, Platform } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { VideoView, useVideoPlayer } from "expo-video";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

export default function UploadScreen() {
  const colors = useColors();
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerDescription, setPlayerDescription] = useState("");
  const [uploading, setUploading] = useState(false);

  const player = useVideoPlayer(videoUri || "", (player) => {
    player.loop = true;
  });

  const pickVideo = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      quality: 1,
      videoMaxDuration: 300, // 5 minutes max
    });

    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
      if (!title) {
        setTitle(`Squash Game ${new Date().toLocaleDateString()}`);
      }
    }
  };

  const uploadMutation = trpc.videos.upload.useMutation();

  const handleUpload = async () => {
    if (!videoUri || !title) return;

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setUploading(true);

    try {
      // Read video file as base64
      const response = await fetch(videoUri);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Remove data URL prefix (e.g., "data:video/mp4;base64,")
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.readAsDataURL(blob);
      });

      // Upload to server
      await uploadMutation.mutateAsync({
        title,
        playerName: playerName || undefined,
        playerDescription: playerDescription || undefined,
        videoBase64: base64,
        mimeType: "video/mp4",
      });
      
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
      router.back();
    } catch (error) {
      console.error("Upload failed:", error);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="max-w-3xl mx-auto w-full flex-1">
      <View className="flex-1 p-6">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-6">
          <View>
            <Text className="text-3xl font-bold text-foreground">
              Upload Video
            </Text>
            <Text className="text-sm text-muted mt-1">
              Select a squash game video for AI analysis
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center"
          >
            <Text className="text-foreground text-2xl">×</Text>
          </TouchableOpacity>
        </View>

        {/* Video Preview */}
        {videoUri ? (
          <View className="mb-6">
            {Platform.OS === "web" ? (
              <View style={{ width: "100%", borderRadius: 16, overflow: "hidden" }}>
                {/* @ts-ignore - video is a valid web element */}
                <video
                  src={videoUri}
                  controls
                  style={{
                    width: "100%",
                    aspectRatio: "16 / 9",
                    maxHeight: 400,
                    display: "block",
                    backgroundColor: colors.surface,
                  }}
                />
              </View>
            ) : (
              <VideoView
                player={player}
                style={{
                  width: "100%",
                  aspectRatio: 16 / 9,
                  borderRadius: 16,
                  backgroundColor: colors.surface,
                }}
                allowsFullscreen
                nativeControls
              />
            )}
          </View>
        ) : (
          <TouchableOpacity
            onPress={pickVideo}
            className="w-full aspect-video bg-surface border-2 border-dashed border-border rounded-2xl items-center justify-center mb-6"
          >
            <View className="items-center">
              <View className="w-16 h-16 bg-primary/10 rounded-full items-center justify-center mb-3">
                <Text className="text-primary text-3xl">+</Text>
              </View>
              <Text className="text-lg font-semibold text-foreground mb-1">
                Select Video
              </Text>
              <Text className="text-sm text-muted">
                Choose a squash game video from your library
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Title Input */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Video Title
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Enter a title for this video"
            placeholderTextColor={colors.muted}
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            style={{ fontSize: 16 }}
          />
        </View>

        {/* Player Information */}
        <View className="mb-4">
          <Text className="text-sm font-medium text-foreground mb-2">
            Player Name (Optional)
          </Text>
          <TextInput
            value={playerName}
            onChangeText={setPlayerName}
            placeholder="e.g., John Smith"
            placeholderTextColor={colors.muted}
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            style={{ fontSize: 16 }}
          />
        </View>

        <View className="mb-6">
          <Text className="text-sm font-medium text-foreground mb-2">
            Player Description (Optional)
          </Text>
          <TextInput
            value={playerDescription}
            onChangeText={setPlayerDescription}
            placeholder="e.g., Wearing blue shirt, playing on the left side"
            placeholderTextColor={colors.muted}
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            style={{ fontSize: 16 }}
            multiline
            numberOfLines={2}
          />
          <Text className="text-xs text-muted mt-1">
            Help the AI identify which player to analyze
          </Text>
        </View>

        {/* Actions */}
        <View className="flex-row gap-3 mt-auto">
          {videoUri && (
            <TouchableOpacity
              onPress={pickVideo}
              className="flex-1 bg-surface border border-border rounded-full py-3 items-center"
            >
              <Text className="text-foreground font-semibold">
                Change Video
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleUpload}
            disabled={!videoUri || !title || uploading}
            className={`flex-1 rounded-full py-3 items-center ${
              !videoUri || !title || uploading
                ? "bg-muted/30"
                : "bg-primary"
            }`}
          >
            {uploading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text
                className={`font-semibold ${
                  !videoUri || !title ? "text-muted" : "text-background"
                }`}
              >
                Analyze Video
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      </View>
    </ScreenContainer>
  );
}
