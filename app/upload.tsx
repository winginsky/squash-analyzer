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
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { getApiBaseUrl } from "@/constants/oauth";

export default function UploadScreen() {
  const colors = useColors();

  // ── Video state ─────────────────────────────────────────────────────────────
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null); // web only
  const [videoFileName, setVideoFileName] = useState<string>("");

  // ── Form fields ─────────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerDescription, setPlayerDescription] = useState("");

  // ── Meeting notes ────────────────────────────────────────────────────────────
  const [meetingNotes, setMeetingNotes] = useState("");
  const [notesFileName, setNotesFileName] = useState("");
  const [gdocUrl, setGdocUrl] = useState("");
  const [gdocLoading, setGdocLoading] = useState(false);
  const [gdocError, setGdocError] = useState("");

  // ── Upload state ─────────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  // ── Refs for hidden file inputs (web) ───────────────────────────────────────
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const notesInputRef = useRef<HTMLInputElement | null>(null);

  // Native video player (used only on native)
  const player = useVideoPlayer(
    Platform.OS !== "web" && videoUri ? videoUri : "",
    (p) => { p.loop = true; }
  );

  // ─── Video picker ────────────────────────────────────────────────────────────
  const pickVideoWeb = () => (videoInputRef.current as any)?.click();

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    setVideoUri(URL.createObjectURL(file));
    setVideoFileName(file.name);
    if (!title) setTitle(`Squash Game ${new Date().toLocaleDateString()}`);
  };

  const pickVideoNative = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      setVideoUri(result.assets[0].uri);
      setVideoFileName(result.assets[0].fileName ?? "video.mp4");
      if (!title) setTitle(`Squash Game ${new Date().toLocaleDateString()}`);
    }
  };

  const pickVideo = Platform.OS === "web" ? pickVideoWeb : pickVideoNative;

  // ─── Notes file picker (web only) ───────────────────────────────────────────
  const pickNotesFile = () => (notesInputRef.current as any)?.click();

  const handleNotesFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNotesFileName(file.name);
    const text = await file.text();
    setMeetingNotes(text);
  };

  // ─── Google Doc fetch ────────────────────────────────────────────────────────
  const fetchGoogleDoc = async () => {
    if (!gdocUrl.trim()) return;
    setGdocLoading(true);
    setGdocError("");
    try {
      const apiBase = getApiBaseUrl();
      const res = await fetch(
        `${apiBase}/api/fetch-gdoc?url=${encodeURIComponent(gdocUrl.trim())}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setMeetingNotes(data.content);
      setNotesFileName("Google Doc");
      setGdocError("");
    } catch (err: any) {
      setGdocError(err.message ?? "Failed to fetch Google Doc");
    } finally {
      setGdocLoading(false);
    }
  };

  // ─── Upload handler ──────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!videoUri || !title) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setUploading(true);
    try {
      const apiBase = getApiBaseUrl();

      // Determine MIME type and get the video blob
      let uploadBlob: Blob;
      let mimeType = "video/mp4";

      if (Platform.OS === "web" && videoFile) {
        uploadBlob = videoFile;
        mimeType = videoFile.type || "video/mp4";
      } else {
        setUploadProgress("Reading video…");
        const res = await fetch(videoUri);
        uploadBlob = await res.blob();
        mimeType = uploadBlob.type || "video/mp4";
      }

      // Normalise MIME so S3 accepts it
      const normMime = (mimeType === "video/quicktime" || mimeType === "")
        ? "video/mp4"
        : mimeType;

      // Step 1 — get presigned upload URL
      setUploadProgress("Preparing upload…");
      const presignRes = await fetch(
        `${apiBase}/api/presign-upload?mimeType=${encodeURIComponent(normMime)}`,
        { credentials: "include" }
      );
      if (!presignRes.ok) throw new Error(`Presign failed: ${presignRes.status}`);
      const { uploadUrl, publicUrl, key: s3Key } = await presignRes.json();

      // Step 2 — PUT directly to S3 (bypasses nginx, no size limit)
      setUploadProgress("Uploading video… (this may take a minute)");
      const s3Res = await fetch(uploadUrl, {
        method: "PUT",
        body: uploadBlob,
        headers: { "Content-Type": normMime },
      });
      if (!s3Res.ok) throw new Error(`S3 upload failed: ${s3Res.status}`);

      // Step 3 — register with API (includes meeting notes)
      setUploadProgress("Starting analysis…");
      const registerRes = await fetch(`${apiBase}/api/register-upload`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3Key,
          s3Url: publicUrl,
          title,
          playerName: playerName.trim() || undefined,
          playerDescription: playerDescription.trim() || undefined,
          meetingNotes: meetingNotes.trim() || undefined,
        }),
      });
      if (!registerRes.ok) throw new Error(`Register failed: ${registerRes.status}`);
      const { id } = await registerRes.json();

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate to the video detail page
      router.replace(`/video/${id}` as any);
    } catch (err: any) {
      console.error("Upload failed:", err);
      setUploadProgress(`❌ Upload failed: ${err.message ?? "Please try again"}`);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = !!videoUri && !!title && !uploading;

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      {/* Hidden file inputs (web) */}
      {Platform.OS === "web" && (
        <>
          {/* @ts-ignore */}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={handleVideoFileChange as any}
          />
          {/* @ts-ignore */}
          <input
            ref={notesInputRef}
            type="file"
            accept=".txt,.md,.text"
            style={{ display: "none" }}
            onChange={handleNotesFileChange as any}
          />
        </>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={{ maxWidth: 720, alignSelf: "center", width: "100%", padding: 24 }}>

          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <View>
              <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>Upload Game</Text>
              <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
                Video + optional coach meeting notes
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center",
                borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.foreground, fontSize: 20 }}>×</Text>
            </TouchableOpacity>
          </View>

          {/* ── Section 1: Video ─────────────────────────────────────────────── */}
          <SectionHeader label="1  Game Video" icon="videocam" colors={colors} />

          {videoUri ? (
            <View style={{ marginBottom: 8 }}>
              {Platform.OS === "web" ? (
                <View style={{ borderRadius: 14, overflow: "hidden", marginBottom: 8 }}>
                  {/* @ts-ignore */}
                  <video src={videoUri} controls style={{ width: "100%", aspectRatio: "16 / 9", maxHeight: 360, display: "block", backgroundColor: "#000" }} />
                </View>
              ) : (
                <VideoView
                  player={player}
                  style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: colors.surface, marginBottom: 8 }}
                  allowsFullscreen nativeControls
                />
              )}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <MaterialIcons name="check-circle" size={16} color={colors.success} />
                <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }} numberOfLines={1}>{videoFileName}</Text>
                <TouchableOpacity onPress={pickVideo}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                  <Text style={{ fontSize: 12, color: colors.foreground }}>Change</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={pickVideo} style={{
              width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.surface,
              borderWidth: 2, borderStyle: "dashed", borderColor: colors.border,
              borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 20,
            }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary + "1A",
                alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <Text style={{ color: colors.primary, fontSize: 28 }}>▶</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
                {Platform.OS === "web" ? "Click to Select Video" : "Select Video"}
              </Text>
              <Text style={{ fontSize: 13, color: colors.muted }}>MP4, MOV, WebM supported</Text>
            </TouchableOpacity>
          )}

          {/* ── Section 2: Game info ─────────────────────────────────────────── */}
          <SectionHeader label="2  Game Info" icon="info" colors={colors} />

          <Field label="Match Title *" colors={colors}>
            <TextInput value={title} onChangeText={setTitle}
              placeholder="e.g. Jeffrey vs Luca — April training"
              placeholderTextColor={colors.muted}
              style={inputStyle(colors)} />
          </Field>

          <Field label="Player to Analyze" hint="Optional" colors={colors}>
            <TextInput value={playerName} onChangeText={setPlayerName}
              placeholder="e.g. Jeffrey"
              placeholderTextColor={colors.muted}
              style={inputStyle(colors)} />
          </Field>

          <Field label="Player Description" hint="Optional" colors={colors}
            helpText="Describe the player so the AI can identify them (e.g. grey shirt, playing on left side)">
            <TextInput value={playerDescription} onChangeText={setPlayerDescription}
              placeholder="e.g. wearing grey shirt"
              placeholderTextColor={colors.muted}
              multiline numberOfLines={2}
              style={[inputStyle(colors), { minHeight: 64, textAlignVertical: "top" }]} />
          </Field>

          {/* ── Section 3: Coach Meeting Notes ──────────────────────────────── */}
          <SectionHeader label="3  Coach Meeting Notes" icon="mic" colors={colors}
            subtitle="AI-transcribed notes from the coach's real-time commentary" />

          <View style={{
            backgroundColor: colors.primary + "08", borderRadius: 12,
            borderWidth: 1, borderColor: colors.primary + "30",
            padding: 12, marginBottom: 14,
          }}>
            <Text style={{ fontSize: 12, color: colors.primary, lineHeight: 18 }}>
              Paste your coach's session notes, or upload a <Text style={{ fontWeight: "700" }}>.txt</Text> file.
              Notes usually cover the full session (3–5 matches) and will be used by the AI to give more targeted feedback.
            </Text>
          </View>

          {/* Google Doc URL input */}
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>
              Google Doc URL
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={gdocUrl}
                onChangeText={setGdocUrl}
                placeholder="https://docs.google.com/document/d/..."
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[inputStyle(colors), { flex: 1, fontSize: 13 }]}
              />
              <TouchableOpacity
                onPress={fetchGoogleDoc}
                disabled={!gdocUrl.trim() || gdocLoading}
                style={{
                  backgroundColor: gdocUrl.trim() ? colors.primary : colors.muted + "50",
                  borderRadius: 10, paddingHorizontal: 14, justifyContent: "center",
                }}
              >
                {gdocLoading
                  ? <ActivityIndicator size="small" color={colors.background} />
                  : <Text style={{ color: colors.background, fontWeight: "700", fontSize: 13 }}>Load</Text>
                }
              </TouchableOpacity>
            </View>
            {gdocError ? (
              <Text style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }}>{gdocError}</Text>
            ) : null}
          </View>

          {/* Notes file upload (web only) */}
          {Platform.OS === "web" && (
            <TouchableOpacity onPress={pickNotesFile} style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              backgroundColor: colors.surface,
              borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border,
              borderRadius: 10, padding: 14, marginBottom: 12,
            }}>
              <MaterialIcons name="upload-file" size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                  {notesFileName && notesFileName !== "Google Doc" ? notesFileName : "Upload notes file"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  {notesFileName && notesFileName !== "Google Doc" ? "Tap to replace" : ".txt or .md — content will load below"}
                </Text>
              </View>
              {notesFileName && notesFileName !== "Google Doc" && <MaterialIcons name="check-circle" size={18} color={colors.success} />}
            </TouchableOpacity>
          )}

          {/* Notes text area */}
          <Field label={notesFileName ? "Notes (loaded from file)" : "Or paste notes directly"}
            hint="Optional" colors={colors}
            helpText={meetingNotes.trim() ? `${meetingNotes.trim().split(/\s+/).length} words — the AI will read all of this` : ""}>
            {Platform.OS === "web" ? (
              // @ts-ignore
              <textarea
                value={meetingNotes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMeetingNotes(e.target.value)}
                placeholder={"Paste coach meeting notes here…\n\nExample:\nMatch 1: Jeffrey's backhand was inconsistent under pressure. He tends to hit too high on the tin on the backhand side. Work on lower contact point.\n\nMatch 2: Better footwork today. Still needs to recover to the T faster after boasts..."}
                rows={10}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 10,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.background, color: colors.foreground,
                  fontSize: 13, lineHeight: "1.6", boxSizing: "border-box",
                  resize: "vertical", fontFamily: "inherit",
                }}
              />
            ) : (
              <TextInput
                value={meetingNotes}
                onChangeText={setMeetingNotes}
                placeholder="Paste coach meeting notes here…"
                placeholderTextColor={colors.muted}
                multiline
                style={[inputStyle(colors), { minHeight: 160, textAlignVertical: "top" }]}
              />
            )}
          </Field>

          {/* ── Upload progress ──────────────────────────────────────────────── */}
          {uploading && (
            <View style={{ marginBottom: 16, padding: 14, backgroundColor: colors.surface,
              borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} style={{ marginBottom: 8 }} />
              <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center" }}>{uploadProgress}</Text>
            </View>
          )}
          {!uploading && uploadProgress.startsWith("❌") && (
            <View style={{ marginBottom: 16, padding: 14, backgroundColor: "rgba(239,68,68,0.08)",
              borderRadius: 10, borderWidth: 1, borderColor: "#EF444455" }}>
              <Text style={{ color: "#DC2626", fontSize: 14, textAlign: "center" }}>{uploadProgress}</Text>
            </View>
          )}

          {/* ── Submit button ────────────────────────────────────────────────── */}
          <TouchableOpacity
            onPress={handleUpload}
            disabled={!canSubmit}
            style={{
              backgroundColor: canSubmit ? colors.primary : colors.muted + "50",
              borderRadius: 50, paddingVertical: 16, alignItems: "center", marginBottom: 8,
            }}
          >
            {uploading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={{ fontWeight: "700", fontSize: 16,
                color: canSubmit ? colors.background : colors.muted }}>
                {meetingNotes.trim() ? "Analyze with Coach Notes" : "Analyze Video"}
              </Text>
            )}
          </TouchableOpacity>

          {!canSubmit && !uploading && (
            <Text style={{ textAlign: "center", fontSize: 13, color: colors.muted, marginBottom: 8 }}>
              {!videoUri ? "Select a video to continue" : "Enter a match title to continue"}
            </Text>
          )}

          <View style={{ height: 32 }} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({
  label, icon, subtitle, colors,
}: {
  label: string;
  icon: string;
  subtitle?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14, marginTop: 8 }}>
      <View style={{ width: 32, height: 32, borderRadius: 16,
        backgroundColor: colors.primary + "18", alignItems: "center", justifyContent: "center", marginRight: 10 }}>
        <MaterialIcons name={icon as any} size={17} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{label}</Text>
        {subtitle && <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{subtitle}</Text>}
      </View>
    </View>
  );
}

function Field({
  label, hint, helpText, children, colors,
}: {
  label: string;
  hint?: string;
  helpText?: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{label}</Text>
        {hint && <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 6 }}>{hint}</Text>}
      </View>
      {children}
      {helpText ? (
        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{helpText}</Text>
      ) : null}
    </View>
  );
}

function inputStyle(colors: ReturnType<typeof useColors>) {
  return {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.foreground,
  } as const;
}
