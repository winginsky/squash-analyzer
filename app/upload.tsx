import { useState, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { VideoView, useVideoPlayer } from "expo-video";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { getApiBaseUrl } from "@/constants/oauth";

type InputMode = "file" | "url";

export default function UploadScreen() {
  const colors = useColors();
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>("");
  const [webFile, setWebFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerDescription, setPlayerDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  // Only used on native
  const player = useVideoPlayer(
    Platform.OS !== "web" && videoUri ? videoUri : "",
    (p) => {
      p.loop = true;
    }
  );

  const pickVideoWeb = () => {
    if (webFileInputRef.current) {
      webFileInputRef.current.click();
    }
  };

  const handleWebFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setVideoUri(objectUrl);
    setVideoFileName(file.name);
    setWebFile(file);
    if (!title) {
      setTitle(`Squash Game ${new Date().toLocaleDateString()}`);
    }
  };

  const pickVideoNative = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      quality: 1,
      videoMaxDuration: 300,
    });
    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
      if (!title) {
        setTitle(`Squash Game ${new Date().toLocaleDateString()}`);
      }
    }
  };

  const pickVideo = Platform.OS === "web" ? pickVideoWeb : pickVideoNative;

  const handleUpload = async () => {
    if (!title) return;
    if (inputMode === "file" && !videoUri) return;
    if (inputMode === "url" && !videoUrl.trim()) return;

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setUploading(true);

    try {
      const apiBase = getApiBaseUrl();

      if (inputMode === "url") {
        setUploadProgress("Submitting link…");
        const res = await fetch(`${apiBase}/api/upload-video-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            url: videoUrl.trim(),
            title,
            playerName: playerName || undefined,
            playerDescription: playerDescription || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error || "Failed to submit link");
        }
      } else {
        setUploadProgress("Uploading video…");
        const formData = new FormData();

        if (Platform.OS === "web") {
          // Use the File reference directly — no base64 encoding needed
          const file = webFile ?? await fetch(videoUri!).then(r => r.blob());
          formData.append("video", file, videoFileName || "video.mp4");
        } else {
          // On native, stream the local file URI as a blob
          const blob = await fetch(videoUri!).then(r => r.blob());
          formData.append("video", blob, "video.mp4");
        }

        formData.append("title", title);
        if (playerName) formData.append("playerName", playerName);
        if (playerDescription) formData.append("playerDescription", playerDescription);

        const res = await fetch(`${apiBase}/api/upload-video`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error || "Upload failed");
        }
      }

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      router.back();
    } catch (error) {
      console.error("Upload failed:", error);
      setUploadProgress("Upload failed. Please try again.");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setUploading(false);
    }
  };

  const canSubmit =
    !!title &&
    !uploading &&
    (inputMode === "file" ? !!videoUri : !!videoUrl.trim());

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      {/* Hidden web file input */}
      {Platform.OS === "web" && (
        // @ts-ignore
        <input
          ref={webFileInputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={handleWebFileChange as any}
        />
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="max-w-3xl mx-auto w-full p-6">
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
              style={{
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 20,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: 20 }}>×</Text>
            </TouchableOpacity>
          </View>

          {/* Mode toggle */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 20,
              padding: 4,
            }}
          >
            {(["file", "url"] as InputMode[]).map((mode) => (
              <TouchableOpacity
                key={mode}
                onPress={() => setInputMode(mode)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 8,
                  alignItems: "center",
                  backgroundColor:
                    inputMode === mode ? colors.primary : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color:
                      inputMode === mode ? colors.background : colors.muted,
                  }}
                >
                  {mode === "file" ? "Upload File" : "Paste Link"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {inputMode === "file" ? (
            <>
              {/* Video Preview / Picker */}
              {videoUri ? (
                <View className="mb-6">
                  {Platform.OS === "web" ? (
                    <View
                      style={{ width: "100%", borderRadius: 16, overflow: "hidden" }}
                    >
                      {/* @ts-ignore */}
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
                  {videoFileName ? (
                    <Text className="text-xs text-muted mt-2 text-center">
                      {videoFileName}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <TouchableOpacity
                  onPress={pickVideo}
                  style={{
                    width: "100%",
                    aspectRatio: 16 / 9,
                    backgroundColor: colors.surface,
                    borderWidth: 2,
                    borderStyle: "dashed",
                    borderColor: colors.border,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 24,
                  }}
                >
                  <View className="items-center">
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        backgroundColor: colors.primary + "1A",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 12,
                      }}
                    >
                      <Text style={{ color: colors.primary, fontSize: 32 }}>▶</Text>
                    </View>
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "600",
                        color: colors.foreground,
                        marginBottom: 4,
                      }}
                    >
                      {Platform.OS === "web"
                        ? "Click to Select Video"
                        : "Select Video"}
                    </Text>
                    <Text style={{ fontSize: 13, color: colors.muted }}>
                      {Platform.OS === "web"
                        ? "MP4, MOV, WebM supported"
                        : "Choose a squash game video from your library"}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}

              {videoUri && (
                <TouchableOpacity
                  onPress={pickVideo}
                  style={{
                    alignSelf: "center",
                    marginBottom: 20,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontSize: 14 }}>
                    Change Video
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            /* URL input */
            <View className="mb-6">
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "500",
                  color: colors.foreground,
                  marginBottom: 8,
                }}
              >
                Video Link
              </Text>
              <TextInput
                value={videoUrl}
                onChangeText={setVideoUrl}
                placeholder="Paste a YouTube or Google Drive link"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  fontSize: 15,
                  color: colors.foreground,
                }}
              />
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
                Google Drive: make sure the file is shared as "Anyone with the link can view"
              </Text>
            </View>
          )}

          {/* Title Input */}
          <View className="mb-4">
            <Text
              style={{
                fontSize: 14,
                fontWeight: "500",
                color: colors.foreground,
                marginBottom: 8,
              }}
            >
              Video Title *
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Training Session March 2026"
              placeholderTextColor={colors.muted}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 16,
                color: colors.foreground,
              }}
            />
          </View>

          {/* Player Name */}
          <View className="mb-4">
            <Text
              style={{
                fontSize: 14,
                fontWeight: "500",
                color: colors.foreground,
                marginBottom: 8,
              }}
            >
              Player Name{" "}
              <Text style={{ color: colors.muted, fontWeight: "400" }}>
                (Optional)
              </Text>
            </Text>
            <TextInput
              value={playerName}
              onChangeText={setPlayerName}
              placeholder="e.g., John Smith"
              placeholderTextColor={colors.muted}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 16,
                color: colors.foreground,
              }}
            />
          </View>

          {/* Player Description */}
          <View className="mb-6">
            <Text
              style={{
                fontSize: 14,
                fontWeight: "500",
                color: colors.foreground,
                marginBottom: 8,
              }}
            >
              Player Description{" "}
              <Text style={{ color: colors.muted, fontWeight: "400" }}>
                (Optional)
              </Text>
            </Text>
            <TextInput
              value={playerDescription}
              onChangeText={setPlayerDescription}
              placeholder="e.g., Wearing blue shirt, playing on the left side"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 16,
                color: colors.foreground,
                minHeight: 80,
                textAlignVertical: "top",
              }}
            />
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
              Describe the player so the AI can identify them in the video
            </Text>
          </View>

          {/* Upload progress */}
          {uploading && uploadProgress ? (
            <View className="mb-4 items-center">
              <Text style={{ color: colors.muted, fontSize: 14 }}>
                {uploadProgress}
              </Text>
            </View>
          ) : null}

          {/* Analyze Button */}
          <TouchableOpacity
            onPress={handleUpload}
            disabled={!canSubmit}
            style={{
              backgroundColor: !canSubmit ? colors.muted + "50" : colors.primary,
              borderRadius: 50,
              paddingVertical: 16,
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            {uploading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text
                style={{
                  fontWeight: "600",
                  fontSize: 16,
                  color: !canSubmit ? colors.muted : colors.background,
                }}
              >
                Analyze Video
              </Text>
            )}
          </TouchableOpacity>

          {!canSubmit && !uploading && (
            <Text
              style={{
                textAlign: "center",
                fontSize: 13,
                color: colors.muted,
                marginBottom: 8,
              }}
            >
              {!title
                ? "Enter a title to continue"
                : inputMode === "file"
                ? "Select a video to continue"
                : "Paste a video link to continue"}
            </Text>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
