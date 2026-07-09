import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Alert } from "react-native";
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
import { SquashBall } from "@/components/squash-ball";
import { useColors } from "@/hooks/use-colors";
import { useAuthContext } from "@/lib/auth-provider";
import Svg, { Polyline } from "react-native-svg";

type VideoAnalysis = {
  id: string;
  title: string;
  playerName?: string;
  date: string;
  dateRaw: Date;
  status: "downloading" | "analyzing" | "complete" | "failed";
  score?: number;
  grade?: string;
  topSuggestion?: string;
  errorMessage?: string;
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
  const [analyzingVideoId, setAnalyzingVideoId] = useState<number | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ step: string; pct: number } | null>(null);
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Video list state ──────────────────────────────────────────
  const { data: videosData, isLoading, refetch } = trpc.videos.list.useQuery(
    undefined,
    { enabled: true } // TODO: restore to `enabled: isAuthenticated` before production
  );
  const deleteVideo = trpc.videos.delete.useMutation({
    onSuccess: () => refetch(),
  });
  const handleDeleteFailed = (id: string, title: string) => {
    Alert.alert(
      "Delete Session",
      `Delete "${title}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteVideo.mutate({ id: parseInt(id, 10) }),
        },
      ]
    );
  };
  const [refreshing, setRefreshing] = useState(false);
  // ── Poll while any video is analyzing; detect completion ──────────────────────
  useEffect(() => {
    if (!videosData) return;
    const hasAnalyzing = videosData.some((v) => v.status === "analyzing" || v.status === "pending" || v.status === "downloading");
    // Detect transitions from analyzing → complete
    videosData.forEach((v) => {
      const prev = prevStatusRef.current[String(v.id)];
      const curr = v.status;
      if ((prev === "analyzing" || prev === "pending" || prev === "downloading") && curr === "complete") {
        showBanner(String(v.id), v.title);
      }
      prevStatusRef.current[String(v.id)] = curr;
    });
    if (!hasAnalyzing) return;
    const timer = setInterval(() => refetch(), 5000);
    return () => clearInterval(timer);
  }, [videosData, refetch, showBanner]);

  // Poll analysis progress while a video is being analyzed
  useEffect(() => {
    if (!analyzingVideoId) return;
    const apiBase = getApiBaseUrl();
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/analysis-progress/${analyzingVideoId}`);
        if (!res.ok) return;
        const data = await res.json() as { step: string; pct: number };
        setAnalysisProgress(data);
        if (data.pct >= 100) {
          clearInterval(poll);
          setTimeout(() => {
            setAnalyzingVideoId(null);
            setAnalysisProgress(null);
          }, 1500);
        }
      } catch { /* ignore */ }
    }, 1000);
    return () => clearInterval(poll);
  }, [analyzingVideoId]);
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
          : v.status === "downloading"
          ? "downloading"
          : "analyzing",
      score: r?.performanceScore ?? undefined,
      grade: r?.performanceGrade ?? undefined,
      topSuggestion: r?.suggestions?.[0]?.title ?? undefined,
      errorMessage: v.errorMessage || undefined,
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
      if (host === "drive.google.com") return "google_drive";
    } catch { /* invalid URL */ }
    return null;
  };
  const getUrlSourceLabel = (url: string) => {
    const src = detectUrlSource(url);
    if (src === "google_drive") return { icon: "📁", label: "Google Drive", color: "#4285F4", warning: null };
    return null;
  };
  const handleUploadUrl = async () => {
    const trimmedUrl = videoUrl.trim();
    if (!trimmedUrl || !title) return;
    const source = detectUrlSource(trimmedUrl);
    if (!source) { setUrlError("Please enter a Google Drive link (drive.google.com/file/d/…/view)."); return; }
    setUrlError("");
    setUploading(true);
    const srcLabel = source === "youtube" ? "YouTube" : source === "google_drive" ? "Google Drive" : "Google Photos";
    setUploadProgress(`Queuing download from ${srcLabel}…`);
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
        try { const j = await res.json(); errMsg = j.detail || j.error || errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      // Server responds immediately — download + analysis runs in background.
      // Clear form and start polling for status updates.
      setVideoUrl(""); setTitle(""); setPlayerName(""); setPlayerDescription(""); setUploadProgress("");
      refetch();
    } catch (err) {
      let msg = err instanceof Error ? err.message : "Failed. Please try again.";
      // Translate the GOOGLE_PHOTOS_UNSUPPORTED sentinel into a friendly UI message
      if (msg.includes("GOOGLE_PHOTOS_UNSUPPORTED")) {
        msg = "Google Photos share links cannot be downloaded automatically.\n\nTo analyse this video:\n\u2022 Open it in Google Photos \u2192 tap \u22ee \u2192 Download, then upload the file\n\u2022 Or upload the video to Google Drive and paste a Drive link instead";
      }
      // Translate the GOOGLE_DRIVE_PRIVATE sentinel into a friendly UI message
      if (msg.includes("GOOGLE_DRIVE_PRIVATE")) {
        msg = "This Google Drive file is not publicly accessible.\n\nTo fix:\n1. Open the file in Google Drive\n2. Right-click \u2192 Share\n3. Change access to \"Anyone with the link can view\"\n4. Copy the share link and paste it here again";
      }
      setUploadProgress(`\u274c ${msg}`);
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

      // Normalise MIME type: video/quicktime → video/mp4 for server compatibility
      const rawMime = fileToUpload.type || "video/mp4";
      const normalisedMime = rawMime === "video/quicktime" ? "video/mp4" : rawMime;
      const ext = normalisedMime.split("/")[1] || "mp4";
      const uploadBlob = normalisedMime !== rawMime
        ? new File([fileToUpload], `video.${ext}`, { type: normalisedMime })
        : fileToUpload;

      const apiBase = getApiBaseUrl();

      // Step 1: get multipart presigned URLs (10 MB chunks uploaded in parallel)
      setUploadProgress("Preparing upload… 0%");
      const presignRes = await fetch(`${apiBase}/api/presign-multipart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title, playerName, playerDescription,
          mimeType: normalisedMime, fileExt: ext,
          fileSize: uploadBlob.size,
        }),
      });
      if (!presignRes.ok) {
        const e = await presignRes.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error || `Presign failed (${presignRes.status})`);
      }
      const { videoId, uploadId, key, videoUrl, partUrls, partSize } =
        await presignRes.json() as {
          videoId: number; uploadId: string; key: string; videoUrl: string;
          partUrls: string[]; partSize: number;
        };

      // Step 2: upload all parts in parallel (4 at a time) with combined progress
      setUploadProgress("Uploading video… 0%");
      const totalSize = uploadBlob.size;
      const bytesUploaded = new Array(partUrls.length).fill(0);
      const updateProgress = () => {
        const done = bytesUploaded.reduce((a, b) => a + b, 0);
        const pct = Math.round((done / totalSize) * 100);
        setUploadProgress(`Uploading video… ${pct}%`);
      };

      const CONCURRENCY = 8;
      const etags: { PartNumber: number; ETag: string }[] = [];
      const uploadPart = async (i: number): Promise<void> => {
        const start = i * partSize;
        const end = Math.min(start + partSize, totalSize);
        const chunk = uploadBlob.slice(start, end);
        const etag = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", partUrls[i]);
          xhr.upload.onprogress = (e) => {
            bytesUploaded[i] = e.loaded;
            updateProgress();
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              bytesUploaded[i] = end - start;
              updateProgress();
              resolve(xhr.getResponseHeader("ETag") ?? "");
            } else {
              reject(new Error(`Part ${i + 1} upload failed (${xhr.status})`));
            }
          };
          xhr.onerror = () => reject(new Error(`Part ${i + 1} network error`));
          xhr.send(chunk);
        });
        etags.push({ PartNumber: i + 1, ETag: etag });
      };

      // Run CONCURRENCY parts at a time
      for (let i = 0; i < partUrls.length; i += CONCURRENCY) {
        await Promise.all(
          partUrls.slice(i, i + CONCURRENCY).map((_, j) => uploadPart(i + j))
        );
      }
      etags.sort((a, b) => a.PartNumber - b.PartNumber);

      // Step 3: complete the multipart upload
      setUploadProgress("Finalising upload…");
      const completeRes = await fetch(`${apiBase}/api/complete-multipart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, uploadId, parts: etags }),
      });
      if (!completeRes.ok) throw new Error("Failed to complete multipart upload");

      // Step 4: tell the server to start analysis
      setUploadProgress("Starting analysis…");
      await fetch(`${apiBase}/api/start-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ videoId, videoUrl, playerName, playerDescription }),
      });

      // Poll analysis progress
      setAnalyzingVideoId(videoId);
      setAnalysisProgress({ step: "Starting…", pct: 0 });

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
    <View style={{ marginBottom: 16 }}>
      <Pressable
        onPress={item.status === "failed" ? undefined : () => router.push(`/video/${item.id}` as any)}
        style={({ pressed }) => ({ opacity: (pressed && item.status !== "failed") ? 0.7 : 1 })}
      >
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: item.status === "failed" ? colors.error + "66" : colors.border,
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
                    : item.status === "downloading"
                    ? colors.primary + "33"
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
                      : item.status === "downloading"
                      ? colors.primary
                      : colors.warning,
                }}
              >
                {item.status === "complete"
                  ? "Complete"
                  : item.status === "failed"
                  ? "Failed"
                  : item.status === "downloading"
                  ? "Downloading…"
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
          {item.status === "failed" && item.errorMessage ? (
            <Text style={{ fontSize: 12, color: colors.error, marginTop: 4, lineHeight: 16 }} numberOfLines={3}>
              {item.errorMessage.replace(/^GOOGLE_DRIVE_PRIVATE:\s*/i, "").replace(/^GOOGLE_PHOTOS_UNSUPPORTED:\s*/i, "").replace(/^YOUTUBE_BOT_DETECTION:\s*/i, "")}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {item.status === "failed" ? (
        <Pressable
          onPress={() => handleDeleteFailed(item.id, item.title)}
          style={({ pressed }) => ({
            marginTop: 6,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: pressed ? colors.error + "44" : colors.error + "18",
            borderWidth: 1,
            borderColor: colors.error + "66",
            alignItems: "center",
          })}
        >
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.error }}>🗑 Delete Session</Text>
        </Pressable>
      ) : null}
    </View>
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
                    placeholder="Paste Google Drive link…"
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
                      { icon: "📁", label: "Google Drive", hint: 'Share link with "Anyone with the link can view"', color: "#4285F4" },
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

            {/* Upload progress bar */}
            {uploadProgress ? (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginBottom: 6 }}>
                  {uploadProgress}
                </Text>
                {(() => {
                  const pct = parseInt(uploadProgress.match(/(\d+)%/)?.[1] ?? "-1");
                  if (pct < 0) return null;
                  return (
                    <View style={{ height: 4, backgroundColor: colors.border ?? "#e0e0e0", borderRadius: 2, marginHorizontal: 8 }}>
                      <View style={{ height: 4, width: `${pct}%` as any, backgroundColor: colors.primary ?? "#007AFF", borderRadius: 2 }} />
                    </View>
                  );
                })()}
              </View>
            ) : null}

            {/* Analysis progress bar (shown after upload completes) */}
            {analysisProgress ? (
              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginBottom: 6 }}>
                  🔍 {analysisProgress.step}
                </Text>
                <View style={{ height: 4, backgroundColor: colors.border ?? "#e0e0e0", borderRadius: 2, marginHorizontal: 8 }}>
                  <View style={{ height: 4, width: `${analysisProgress.pct}%` as any, backgroundColor: "#34C759", borderRadius: 2 }} />
                </View>
              </View>
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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <SquashBall size={18} />
                  <Text
                    style={{
                      fontWeight: "600",
                      fontSize: 16,
                      color:
                        (inputMode === "file" ? !videoUri : !videoUrl.trim()) || !title ? colors.muted : colors.background,
                    }}
                  >
                    Analyze Video
                  </Text>
                </View>
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
              <View style={{ marginBottom: 8 }}>
                <SquashBall size={40} />
              </View>
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
