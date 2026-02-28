import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { getApiBaseUrl } from "@/constants/oauth";
import {
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  ScrollView,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

type VideoAnalysis = {
  id: string;
  title: string;
  playerName?: string;
  date: string;
  status: "analyzing" | "complete" | "failed";
};

export default function HomeScreen() {
  const colors = useColors();

  // ── Upload state ──────────────────────────────────────────────
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState("");
  const [title, setTitle] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerDescription, setPlayerDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Video list state ──────────────────────────────────────────
  const { data: videosData, isLoading, refetch } = trpc.videos.list.useQuery();
  const [refreshing, setRefreshing] = useState(false);

  const videos: VideoAnalysis[] = (videosData || []).map((v) => ({
    id: v.id.toString(),
    title: v.title,
    playerName: v.playerName || undefined,
    date: new Date(v.createdAt).toLocaleDateString(),
    status:
      v.status === "complete"
        ? "complete"
        : v.status === "failed"
        ? "failed"
        : "analyzing",
  }));

  // ── File picking ──────────────────────────────────────────────
  const pickVideoWeb = () => {
    if (webFileInputRef.current) webFileInputRef.current.click();
  };

  const handleWebFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoUri(URL.createObjectURL(file));
    setVideoFileName(file.name);
    if (!title) setTitle(`Squash Game ${new Date().toLocaleDateString()}`);
    // reset so same file can be re-selected
    if (webFileInputRef.current) webFileInputRef.current.value = "";
  };

  // ── Upload ────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!videoUri || !title) return;
    setUploading(true);
    setUploadProgress("Preparing video…");
    try {
      // Fetch the object URL as a blob (works on web with object URLs)
      const response = await fetch(videoUri);
      const blob = await response.blob();

      setUploadProgress("Uploading to server…");

      // Build multipart FormData — no base64 encoding needed
      const formData = new FormData();
      const ext = (blob.type || "video/mp4").split("/")[1] || "mp4";
      formData.append("video", blob, `video.${ext}`);
      formData.append("title", title);
      if (playerName) formData.append("playerName", playerName);
      if (playerDescription) formData.append("playerDescription", playerDescription);

      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/upload-video`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server error ${res.status}: ${errText}`);
      }

      // Reset form
      setVideoUri(null);
      setVideoFileName("");
      setTitle("");
      setPlayerName("");
      setPlayerDescription("");
      setUploadProgress("");
      refetch();
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadProgress("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // ── Video card ────────────────────────────────────────────────
  const renderVideoCard = ({ item }: { item: VideoAnalysis }) => (
    <Pressable
      onPress={() => router.push(`/video/${item.id}` as any)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flex: 1 })}
      className="mb-4"
    >
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: colors.foreground,
              flex: 1,
              marginRight: 8,
            }}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
              backgroundColor:
                item.status === "complete"
                  ? colors.success + "33"
                  : item.status === "failed"
                  ? colors.error + "33"
                  : colors.warning + "33",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "500",
                color:
                  item.status === "complete"
                    ? colors.success
                    : item.status === "failed"
                    ? colors.error
                    : colors.warning,
              }}
            >
              {item.status === "complete"
                ? "Complete"
                : item.status === "failed"
                ? "Failed"
                : "Analyzing…"}
            </Text>
          </View>
        </View>
        {item.playerName ? (
          <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 2 }}>
            Player: {item.playerName}
          </Text>
        ) : null}
        <Text style={{ fontSize: 13, color: colors.muted }}>{item.date}</Text>
      </View>
    </Pressable>
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <ScreenContainer>
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <View
          style={{
            maxWidth: 900,
            width: "100%",
            alignSelf: "center",
            padding: 24,
          }}
        >
          {/* ── Page title ── */}
          <Text
            style={{
              fontSize: 28,
              fontWeight: "700",
              color: colors.foreground,
              marginBottom: 4,
            }}
          >
            Squash Analyzer
          </Text>
          <Text
            style={{ fontSize: 15, color: colors.muted, marginBottom: 24 }}
          >
            Upload a squash game video and get AI coaching feedback
          </Text>

          {/* ── Upload card ── */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 20,
              padding: 20,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 32,
            }}
          >
            <Text
              style={{
                fontSize: 17,
                fontWeight: "600",
                color: colors.foreground,
                marginBottom: 16,
              }}
            >
              Upload New Video
            </Text>

            {/* Video picker area */}
            <TouchableOpacity
              onPress={pickVideoWeb}
              style={{
                width: "100%",
                aspectRatio: 16 / 7,
                backgroundColor: videoUri
                  ? colors.primary + "15"
                  : colors.background,
                borderWidth: 2,
                borderStyle: "dashed",
                borderColor: videoUri ? colors.primary : colors.border,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              {videoUri ? (
                <View style={{ alignItems: "center" }}>
                  <Text style={{ fontSize: 32, marginBottom: 6 }}>🎬</Text>
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: colors.primary,
                      marginBottom: 4,
                    }}
                  >
                    Video Selected
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.muted,
                      maxWidth: 260,
                      textAlign: "center",
                    }}
                    numberOfLines={2}
                  >
                    {videoFileName}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.primary,
                      marginTop: 6,
                    }}
                  >
                    Tap to change
                  </Text>
                </View>
              ) : (
                <View style={{ alignItems: "center" }}>
                  <Text style={{ fontSize: 36, marginBottom: 8 }}>📹</Text>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.foreground,
                      marginBottom: 4,
                    }}
                  >
                    Click to Select Video
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>
                    MP4, MOV, WebM supported
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Two-column layout for fields on wider screens */}
            <View
              style={{
                flexDirection: Platform.OS === "web" ? "row" : "column",
                gap: 12,
                marginBottom: 12,
              }}
            >
              {/* Title */}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "500",
                    color: colors.foreground,
                    marginBottom: 6,
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
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    fontSize: 15,
                    color: colors.foreground,
                  }}
                />
              </View>

              {/* Player Name */}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "500",
                    color: colors.foreground,
                    marginBottom: 6,
                  }}
                >
                  Player Name{" "}
                  <Text style={{ color: colors.muted, fontWeight: "400" }}>
                    (optional)
                  </Text>
                </Text>
                <TextInput
                  value={playerName}
                  onChangeText={setPlayerName}
                  placeholder="e.g., John Smith"
                  placeholderTextColor={colors.muted}
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    fontSize: 15,
                    color: colors.foreground,
                  }}
                />
              </View>
            </View>

            {/* Player description */}
            <View style={{ marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: colors.foreground,
                  marginBottom: 6,
                }}
              >
                Player Description{" "}
                <Text style={{ color: colors.muted, fontWeight: "400" }}>
                  (optional — helps AI identify the player)
                </Text>
              </Text>
              <TextInput
                value={playerDescription}
                onChangeText={setPlayerDescription}
                placeholder="e.g., Wearing blue shirt, playing on the left side of the court"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={2}
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  fontSize: 15,
                  color: colors.foreground,
                  minHeight: 64,
                  textAlignVertical: "top",
                }}
              />
            </View>

            {/* Progress message */}
            {uploadProgress ? (
              <Text
                style={{
                  fontSize: 13,
                  color: colors.muted,
                  textAlign: "center",
                  marginBottom: 10,
                }}
              >
                {uploadProgress}
              </Text>
            ) : null}

            {/* Analyze button */}
            <TouchableOpacity
              onPress={handleUpload}
              disabled={!videoUri || !title || uploading}
              style={{
                backgroundColor:
                  !videoUri || !title || uploading
                    ? colors.muted + "50"
                    : colors.primary,
                borderRadius: 50,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              {uploading ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text
                  style={{
                    fontWeight: "600",
                    fontSize: 16,
                    color:
                      !videoUri || !title ? colors.muted : colors.background,
                  }}
                >
                  🎾 Analyze Video
                </Text>
              )}
            </TouchableOpacity>

            {!videoUri && !uploading && (
              <Text
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  color: colors.muted,
                  marginTop: 8,
                }}
              >
                Select a video file to get started
              </Text>
            )}
          </View>

          {/* ── Past analyses ── */}
          <Text
            style={{
              fontSize: 20,
              fontWeight: "700",
              color: colors.foreground,
              marginBottom: 12,
            }}
          >
            Past Analyses
          </Text>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : videos.length === 0 ? (
            <View
              style={{
                alignItems: "center",
                paddingVertical: 40,
                backgroundColor: colors.surface,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 32, marginBottom: 8 }}>🎾</Text>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  color: colors.foreground,
                  marginBottom: 4,
                }}
              >
                No analyses yet
              </Text>
              <Text style={{ fontSize: 14, color: colors.muted }}>
                Upload your first video above to get started
              </Text>
            </View>
          ) : (
            <FlatList
              data={videos}
              renderItem={renderVideoCard}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              numColumns={Platform.OS === "web" ? 2 : 1}
              key={Platform.OS === "web" ? "grid" : "list"}
              columnWrapperStyle={
                Platform.OS === "web" ? { gap: 16 } : undefined
              }
            />
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
