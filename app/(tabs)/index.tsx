import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import Svg, { Polyline } from "react-native-svg";

type VideoAnalysis = {
  id: string;
  title: string;
  playerName?: string;
  date: string;
  dateRaw: Date;
  status: "analyzing" | "complete" | "failed";
  score?: number;
  grade?: string;
  topSuggestion?: string;
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
  // Input mode: file | url
  const [inputMode, setInputMode] = useState<"file" | "url">("file");
  const [videoUrl, setVideoUrl] = useState(""); // external URL input
  const [urlError, setUrlError] = useState("");
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
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
    { enabled: true } // TODO: restore to `enabled: isAuthenticated` before production
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
  const videos: VideoAnalysis[] = (videosData || []).map((v) => {
    const r = (v.analysisResults as { performanceScore?: number; performanceGrade?: string; suggestions?: { title: string }[] } | null) ?? null;
    return {
      id: v.id.toString(),
      title: v.title,
      playerName: v.playerName || undefined,
      date: new Date(v.createdAt).toLocaleDateString(),
      dateRaw: new Date(v.createdAt),
      status:
        v.status === "complete"
          ? "complete"
          : v.status === "failed"
          ? "failed"
          : "analyzing",
      score: r?.performanceScore ?? undefined,
      grade: r?.performanceGrade ?? undefined,
      topSuggestion: r?.suggestions?.[0]?.title ?? undefined,
    };
  });

  // ── Player grouping ──────────────────────────────────────────
  type PlayerGroup = {
    name: string | null; // null = "No Player"
    videos: VideoAnalysis[];
    latestScore?: number;
    latestGrade?: string;
    avgScore?: number;
    sessionCount: number;
    recentScores: number[]; // last 5 scores oldest→newest for sparkline
    lastDate: string;
  };
  const playerGroups = useMemo((): PlayerGroup[] => {
    if (!videos.length) return [];
    const map = new Map<string, VideoAnalysis[]>();
    videos.forEach((v) => {
      const key = v.playerName || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    });
    const groups: PlayerGroup[] = [];
    map.forEach((vids, key) => {
      const sorted = [...vids].sort((a, b) => a.dateRaw.getTime() - b.dateRaw.getTime());
      const completed = sorted.filter((v) => v.status === "complete" && typeof v.score === "number");
      const scores = completed.map((v) => v.score!);
      const latest = sorted[sorted.length - 1];
      const latestCompleted = [...completed].reverse()[0];
      groups.push({
        name: key === "__none__" ? null : key,
        videos: sorted.reverse(), // newest first for display
        latestScore: latestCompleted?.score,
        latestGrade: latestCompleted?.grade,
        avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : undefined,
        sessionCount: vids.length,
        recentScores: scores.slice(-5),
        lastDate: latest.date,
      });
    });
    // Sort: named players first (by session count desc), then "No Player" group
    return groups.sort((a, b) => {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return b.sessionCount - a.sessionCount;
    });
  }, [videos]);
  const gradeColor = (grade?: string) => {
    switch (grade) {
      case "A": return "#22C55E";
      case "B": return colors.primary;
      case "C": return "#F59E0B";
      case "D": return "#EF4444";
      default: return colors.muted;
    }
  };
  const playerAvatarColor = (name: string | null) => {
    if (!name) return colors.muted;
    const palette = ["#0a7ea4", "#7C3AED", "#DB2777", "#D97706", "#059669", "#DC2626", "#2563EB"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return palette[Math.abs(hash) % palette.length];
  };
  const playerInitials = (name: string | null) => {
    if (!name) return "?";
    return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  };
  // ── File picking ──────────────────────────────────────────────
  const pickVideoWeb = () => {
    if (webFileInputRef.current) webFileInputRef.current.click();
  };

  const handleWebFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Store the File object directly — avoids fetch(objectURL) failures for .mov
    setVideoFile(file);
    setVideoUri(URL.createObjectURL(file));
    setVideoFileName(file.name);
    if (!title) setTitle(`Squash Game ${new Date().toLocaleDateString()}`);
    // reset so same file can be re-selected
    if (webFileInputRef.current) webFileInputRef.current.value = "";
  };

  // ── Upload ────────────────────────────────────────────────────
  // URL source detection helpers
  const detectUrlSource = (url: string): "youtube" | "google_drive" | "google_photos" | null => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") return "youtube";
      if (host === "drive.google.com") return "google_drive";
      if (host === "photos.google.com" || host === "lh3.googleusercontent.com" || host === "photos.app.goo.gl" || host === "goo.gl") return "google_photos";
    } catch { /* invalid URL */ }
    return null;
  };
  const isGooglePhotosShareLink = (url: string) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return host === "photos.google.com" || host === "photos.app.goo.gl" || host === "goo.gl";
    } catch { return false; }
  };
  const getUrlSourceLabel = (url: string) => {
    const src = detectUrlSource(url);
    if (src === "youtube") return { icon: "▶", label: "YouTube", color: "#FF0000", warning: null };
    if (src === "google_drive") return { icon: "📁", label: "Google Drive", color: "#4285F4", warning: null };
    if (src === "google_photos") {
      if (isGooglePhotosShareLink(url)) {
        return { icon: "⚠️", label: "Google Photos (not supported)", color: "#F59E0B",
          warning: "Google Photos share links cannot be downloaded. Upload the file directly or use a Google Drive link instead." };
      }
      return { icon: "🖼", label: "Google Photos", color: "#34A853", warning: null };
    }
    return null;
  };
  const handleUploadUrl = async () => {
    const trimmedUrl = videoUrl.trim();
    if (!trimmedUrl || !title) return;
    const source = detectUrlSource(trimmedUrl);
    if (!source) { setUrlError("Please enter a YouTube, Google Drive, or Google Photos link."); return; }
    setUrlError("");
    setUploading(true);
    const srcLabel = source === "youtube" ? "YouTube" : source === "google_drive" ? "Google Drive" : "Google Photos";
    setUploadProgress(`Downloading from ${srcLabel}… (this may take a minute)`);
    try {
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/upload-video-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: trimmedUrl, title, playerName: playerName || undefined, playerDescription: playerDescription || undefined }),
      });
      if (!res.ok) {
        let errMsg = `Failed (HTTP ${res.status})`;
        try { const j = await res.json(); errMsg = j.error || j.detail || errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      setVideoUrl(""); setTitle(""); setPlayerName(""); setPlayerDescription(""); setUploadProgress("");
      refetch();
    } catch (err) {
      let msg = err instanceof Error ? err.message : "Failed. Please try again.";
      // Translate the GOOGLE_PHOTOS_UNSUPPORTED sentinel into a friendly UI message
      if (msg.includes("GOOGLE_PHOTOS_UNSUPPORTED")) {
        msg = "Google Photos share links cannot be downloaded automatically.\n\nTo analyse this video:\n• Open it in Google Photos → tap ⋮ → Download, then upload the file\n• Or upload the video to Google Drive and paste a Drive link instead";
      }
      setUploadProgress(`❌ ${msg}`);
    } finally { setUploading(false); }
  };
  const handleUpload = async () => {
    if (!videoUri || !title) return;
    setUploading(true);
    setUploadProgress("Preparing video…");
    try {
      // Use the stored File object directly if available (avoids fetch(objectURL)
      // failures for .mov / video/quicktime files in some browsers).
      // Fall back to fetching the object URL for any edge case where File is missing.
      let fileToUpload: File | Blob;
      if (videoFile) {
        fileToUpload = videoFile;
      } else {
        const response = await fetch(videoUri);
        fileToUpload = await response.blob();
      }

      setUploadProgress("Uploading to server…");

      // Normalise MIME type: video/quicktime → video/mp4 for server compatibility
      const rawMime = fileToUpload.type || "video/mp4";
      const normalisedMime = rawMime === "video/quicktime" ? "video/mp4" : rawMime;
      const ext = normalisedMime.split("/")[1] || "mp4";

      // Build multipart FormData — no base64 encoding needed
      const formData = new FormData();
      // Re-wrap with normalised MIME so multer receives a consistent type
      const uploadBlob = normalisedMime !== rawMime
        ? new File([fileToUpload], `video.${ext}`, { type: normalisedMime })
        : fileToUpload;
      formData.append("video", uploadBlob, `video.${ext}`);
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
      setVideoFile(null);
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
  // ── Auth gate temporarily disabled for testing ──────────────
  // TODO: Re-enable before production
  // if (authLoading) { ... }
  // if (!isAuthenticated) { ... }

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
                marginBottom: 14,
              }}
            >
              Analyze New Video
            </Text>

            {/* Mode toggle: File Upload vs URL */}
            <View style={{ flexDirection: "row", backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 16, overflow: "hidden" }}>
              <TouchableOpacity
                onPress={() => { setInputMode("file"); setUrlError(""); setUploadProgress(""); }}
                style={{ flex: 1, paddingVertical: 9, alignItems: "center", backgroundColor: inputMode === "file" ? colors.primary : "transparent", borderRadius: 9 }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: inputMode === "file" ? colors.background : colors.muted }}>📹 Upload File</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setInputMode("url"); setUploadProgress(""); }}
                style={{ flex: 1, paddingVertical: 9, alignItems: "center", backgroundColor: inputMode === "url" ? colors.primary : "transparent", borderRadius: 9 }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: inputMode === "url" ? colors.background : colors.muted }}>🔗 Paste Link</Text>
              </TouchableOpacity>
            </View>

            {inputMode === "url" && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground, marginBottom: 6 }}>Video Link</Text>
                <View style={{ position: "relative" }}>
                  <TextInput
                    value={videoUrl}
                    onChangeText={(t) => { setVideoUrl(t); setUrlError(""); }}
                    placeholder="Paste YouTube, Google Drive, or Google Photos link…"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: urlError ? colors.error : videoUrl && detectUrlSource(videoUrl) ? colors.success : colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, paddingRight: videoUrl ? 44 : 14, fontSize: 14, color: colors.foreground }}
                  />
                  {videoUrl ? (
                    <TouchableOpacity onPress={() => { setVideoUrl(""); setUrlError(""); }} style={{ position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" }}>
                      <Text style={{ fontSize: 16, color: colors.muted }}>✕</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {videoUrl ? (() => {
                  const src = getUrlSourceLabel(videoUrl);
                  if (!src) return null;
                  return (
                    <View style={{ marginTop: 6, gap: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ backgroundColor: src.color + "20", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Text style={{ fontSize: 12 }}>{src.icon}</Text>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: src.color }}>{src.label} detected</Text>
                        </View>
                        {!src.warning && <Text style={{ fontSize: 11, color: colors.muted }}>Video will be downloaded server-side</Text>}
                      </View>
                      {src.warning ? (
                        <View style={{ backgroundColor: colors.warning + "18", borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: colors.warning }}>
                          <Text style={{ fontSize: 12, color: colors.foreground, lineHeight: 18 }}>{src.warning}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })() : null}
                {urlError ? <Text style={{ fontSize: 12, color: colors.error, marginTop: 6 }}>{urlError}</Text> : null}
                {!videoUrl && (
                  <View style={{ marginTop: 10, gap: 6 }}>
                    {[
                      { icon: "▶", label: "YouTube", hint: "Any public or unlisted video", color: "#FF0000" },
                      { icon: "📁", label: "Google Drive", hint: 'Share link with "Anyone with the link"', color: "#4285F4" },
                      { icon: "🖼", label: "Google Photos", hint: "Direct lh3.googleusercontent.com links only", color: "#34A853" },
                    ].map((s) => (
                      <View key={s.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: s.color + "15", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 14 }}>{s.icon}</Text>
                        </View>
                        <View>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{s.label}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>{s.hint}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {inputMode === "file" && (
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
            )}
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
              onPress={inputMode === "url" ? handleUploadUrl : handleUpload}
              disabled={(inputMode === "file" ? !videoUri : !videoUrl.trim()) || !title || uploading}
              style={{
                backgroundColor:
                  (inputMode === "file" ? !videoUri : !videoUrl.trim()) || !title || uploading
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
                      (inputMode === "file" ? !videoUri : !videoUrl.trim()) || !title ? colors.muted : colors.background,
                  }}
                >
                  🎾 Analyze Video
                </Text>
              )}
            </TouchableOpacity>

            {inputMode === "file" && !videoUri && !uploading && (
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

          {/* ── Players section ── */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>Players</Text>
            {playerGroups.length > 0 && (
              <Text style={{ fontSize: 13, color: colors.muted }}>{playerGroups.length} player{playerGroups.length !== 1 ? "s" : ""}</Text>
            )}
          </View>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : playerGroups.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 40, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>🎾</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>No analyses yet</Text>
              <Text style={{ fontSize: 14, color: colors.muted }}>Upload your first video above to get started</Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {playerGroups.map((group) => {
                const avatarColor = playerAvatarColor(group.name);
                const initials = playerInitials(group.name);
                const gc = gradeColor(group.latestGrade);
                const pts = group.recentScores;
                const sparkW = 56, sparkH = 28;
                const minS = pts.length ? Math.min(...pts) : 0;
                const maxS = pts.length ? Math.max(...pts) : 100;
                const sparkPoints = pts.map((s, i) => {
                  const x = pts.length < 2 ? sparkW / 2 : (i / (pts.length - 1)) * sparkW;
                  const y = sparkH - ((s - minS) / Math.max(maxS - minS, 1)) * (sparkH - 4) - 2;
                  return `${x},${y}`;
                }).join(" ");
                return (
                  <TouchableOpacity
                    key={group.name ?? "__none__"}
                    onPress={() => router.push(`/player/${encodeURIComponent(group.name ?? "__none__")}` as any)}
                    style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }}
                    activeOpacity={0.75}
                  >
                    {/* Avatar */}
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: avatarColor + "22", borderWidth: 2, borderColor: avatarColor, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 16, fontWeight: "800", color: avatarColor }}>{initials}</Text>
                    </View>
                    {/* Info */}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                        {group.name ?? "Unassigned Videos"}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {group.sessionCount} session{group.sessionCount !== 1 ? "s" : ""} · Last: {group.lastDate}
                      </Text>
                      {group.avgScore !== undefined && (
                        <Text style={{ fontSize: 12, color: colors.muted }}>Avg score: <Text style={{ fontWeight: "600", color: colors.foreground }}>{group.avgScore}</Text></Text>
                      )}
                    </View>
                    {/* Sparkline */}
                    {pts.length >= 2 && (
                      <View style={{ alignItems: "center", gap: 2 }}>
                        <Svg width={sparkW} height={sparkH}>
                          <Polyline points={sparkPoints} fill="none" stroke={gc} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                        </Svg>
                        <Text style={{ fontSize: 9, color: colors.muted }}>trend</Text>
                      </View>
                    )}
                    {/* Grade ring */}
                    {group.latestGrade ? (
                      <View style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 3, borderColor: gc, alignItems: "center", justifyContent: "center", backgroundColor: gc + "18" }}>
                        <Text style={{ fontSize: 16, fontWeight: "800", color: gc }}>{group.latestGrade}</Text>
                      </View>
                    ) : (
                      <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {/* ── Sign out ── */}
          <TouchableOpacity
            onPress={handleLogout}
            style={{ marginTop: 32, alignItems: "center", paddingVertical: 12 }}
          >
            <Text style={{ fontSize: 14, color: colors.muted }}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
