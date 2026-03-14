import { useState, useRef, useEffect, useCallback } from "react";
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
  Animated,
} from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuthContext } from "@/lib/auth-provider";

type VideoAnalysis = {
  id: string;
  title: string;
  playerName?: string;
  date: string;
  status: "analyzing" | "complete" | "failed";
};

export default function HomeScreen() {
  const colors = useColors();
  const { user, loading: authLoading, isAuthenticated, logout } = useAuthContext();

  // ── Analysis-complete banner ──────────────────────────────────
  const [banner, setBanner] = useState<{ id: string; title: string } | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStatusRef = useRef<Record<string, string>>({});
  const showBanner = useCallback((id: string, title: string) => {
    setBanner({ id, title });
    bannerAnim.setValue(0);
    Animated.spring(bannerAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => {
      Animated.timing(bannerAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setBanner(null));
    }, 6000);
  }, [bannerAnim]);
  const dismissBanner = useCallback(() => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    Animated.timing(bannerAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setBanner(null));
  }, [bannerAnim]);
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
  const { data: videosData, isLoading, refetch } = trpc.videos.list.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );
  const [refreshing, setRefreshing] = useState(false);
  // ── Poll while any video is analyzing; detect completion ──────────────────────
  useEffect(() => {
    if (!videosData) return;
    const hasAnalyzing = videosData.some((v) => v.status === "analyzing" || v.status === "pending");
    // Detect transitions from analyzing → complete
    videosData.forEach((v) => {
      const prev = prevStatusRef.current[String(v.id)];
      const curr = v.status;
      if ((prev === "analyzing" || prev === "pending") && curr === "complete") {
        showBanner(String(v.id), v.title);
      }
      prevStatusRef.current[String(v.id)] = curr;
    });
    if (!hasAnalyzing) return;
    const timer = setInterval(() => refetch(), 5000);
    return () => clearInterval(timer);
  }, [videosData, refetch, showBanner]);
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
        let errMsg = `Upload failed (HTTP ${res.status})`;
        try {
          const errJson = await res.json();
          errMsg = errJson.error || errMsg;
        } catch {
          const errText = await res.text().catch(() => "");
          if (errText) errMsg = errText;
        }
        throw new Error(errMsg);
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
      const msg = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setUploadProgress(`❌ ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login" as any);
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

  // ── Auth loading state ────────────────────────────────────────
  if (authLoading) {
    return (
      <ScreenContainer className="items-center justify-center">
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={{ marginTop: 12, fontSize: 14, color: colors.muted }}>Loading…</Text>
      </ScreenContainer>
    );
  }

  // ── Login gate ────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <ScreenContainer className="items-center justify-center px-8">
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🎾</Text>
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.foreground, marginBottom: 8, textAlign: "center" }}>
          Squash Analyzer
        </Text>
        <Text style={{ fontSize: 15, color: colors.muted, textAlign: "center", marginBottom: 32 }}>
          Sign in to upload videos and get AI coaching insights
        </Text>
        <TouchableOpacity
          onPress={() => router.push("/login" as any)}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 32,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.background }}>
            Sign In
          </Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

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
      {/* ── Analysis-complete banner ── */}
      {banner && (
        <Animated.View
          style={{
            position: "absolute",
            top: 12,
            left: 16,
            right: 16,
            zIndex: 999,
            transform: [{
              translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] }),
            }],
            opacity: bannerAnim,
          }}
        >
          <View
            style={{
              backgroundColor: colors.success,
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 8,
              elevation: 8,
            }}
          >
            <Text style={{ fontSize: 20 }}>✅</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>Analysis Complete</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }} numberOfLines={1}>{banner.title}</Text>
            </View>
            <TouchableOpacity
              onPress={() => { dismissBanner(); router.push(`/video/${banner.id}` as any); }}
              style={{ backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>View</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={dismissBanner} style={{ padding: 4 }}>
              <Text style={{ fontSize: 16, color: "rgba(255,255,255,0.7)" }}>✕</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
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
          {/* ── Page header with user info ── */}
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
                fontSize: 28,
                fontWeight: "700",
                color: colors.foreground,
              }}
            >
              Squash Analyzer
            </Text>
            {/* User avatar / logout button */}
            <TouchableOpacity
              onPress={() => router.push("/profile" as any)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: colors.surface,
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.background }}>
                  {(user?.name || user?.email || "U").charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "500", maxWidth: 100 }} numberOfLines={1}>
                {user?.name || user?.email || "Profile"}
              </Text>
            </TouchableOpacity>
          </View>
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

          {/* ── Sign out ── */}
          <TouchableOpacity
            onPress={handleLogout}
            style={{
              marginTop: 32,
              alignItems: "center",
              paddingVertical: 12,
            }}
          >
            <Text style={{ fontSize: 14, color: colors.muted }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
