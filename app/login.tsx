import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  TextInput,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useState } from "react";
import { SmartSquashLogoLarge } from "@/components/smartsquash-logo";
import { getApiBaseUrl } from "@/constants/oauth";
import { useRouter } from "expo-router";
import * as AuthLib from "@/lib/_core/auth";
import * as Linking from "expo-linking";

type Mode = "choose" | "login" | "register";

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const apiBase = getApiBaseUrl();

  // ── Google OAuth ──────────────────────────────────────────────────────────
  const handleGoogleLogin = () => {
    setError("");
    if (Platform.OS === "web") {
      const redirect = typeof window !== "undefined" ? window.location.origin : apiBase;
      window.location.href = `${apiBase}/api/auth/google?platform=web&redirect=${encodeURIComponent(redirect)}`;
    } else {
      // Mobile: open deep-link-based OAuth flow
      const deepLink = Linking.createURL("/oauth/callback");
      Linking.openURL(
        `${apiBase}/api/auth/google?platform=mobile&redirect=${encodeURIComponent(deepLink)}`
      );
    }
  };

  // ── Email / password ──────────────────────────────────────────────────────
  const handleEmailAuth = async () => {
    setError("");
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (mode === "register" && !name) {
      setError("Please enter your name.");
      return;
    }
    setLoading(true);
    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body: Record<string, string> = { email, password };
      if (mode === "register") body.name = name;

      const res = await fetch(`${apiBase}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      // Store token for native, web uses cookie automatically
      if (Platform.OS !== "web" && data.token) {
        await AuthLib.setSessionToken(data.token);
        if (data.user) await AuthLib.setUserInfo(data.user);
      }

      router.replace("/");
    } catch (e) {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenContainer edges={["top", "bottom", "left", "right"]} className="px-8">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={{ marginBottom: 24, shadowColor: "#00ff88", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 24, elevation: 8 }}>
            <SmartSquashLogoLarge size={100} />
          </View>

          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.primary, letterSpacing: 3, marginBottom: 6, textAlign: "center" }}>
            SMARTSQUASH
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginBottom: 36, lineHeight: 22 }}>
            AI-powered coaching insights{"\n"}from your match footage
          </Text>

          {mode === "choose" && (
            <>
              {/* Feature bullets */}
              {[
                { icon: "📊", label: "Game stats & shot breakdown" },
                { icon: "🧠", label: "Strategy analysis & weaknesses" },
                { icon: "🎯", label: "Top 4 improvement areas with drills" },
                { icon: "📈", label: "Progress tracking over time" },
              ].map((f) => (
                <View key={f.label} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10, alignSelf: "stretch" }}>
                  <Text style={{ fontSize: 18, width: 26, textAlign: "center" }}>{f.icon}</Text>
                  <Text style={{ fontSize: 14, color: colors.muted, flex: 1 }}>{f.label}</Text>
                </View>
              ))}

              <View style={{ height: 32 }} />

              {/* Google button */}
              <Pressable
                onPress={handleGoogleLogin}
                style={({ pressed }) => ({
                  alignSelf: "stretch",
                  backgroundColor: "#fff",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 10,
                  opacity: pressed ? 0.85 : 1,
                  marginBottom: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                })}
              >
                <Text style={{ fontSize: 20 }}>G</Text>
                <Text style={{ fontSize: 15, fontWeight: "600", color: "#333" }}>Continue with Google</Text>
              </Pressable>

              {/* Divider */}
              <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch", marginVertical: 12, gap: 10 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                <Text style={{ color: colors.muted, fontSize: 13 }}>or</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              </View>

              {/* Email login */}
              <Pressable
                onPress={() => setMode("login")}
                style={({ pressed }) => ({
                  alignSelf: "stretch",
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                  opacity: pressed ? 0.85 : 1,
                  marginBottom: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                })}
              >
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>Sign in with Email</Text>
              </Pressable>

              {/* Register */}
              <Pressable onPress={() => setMode("register")}>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 8 }}>
                  New here? <Text style={{ color: colors.primary, fontWeight: "600" }}>Create an account</Text>
                </Text>
              </Pressable>
            </>
          )}

          {(mode === "login" || mode === "register") && (
            <>
              <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, alignSelf: "flex-start", marginBottom: 20 }}>
                {mode === "login" ? "Sign In" : "Create Account"}
              </Text>

              {mode === "register" && (
                <TextInput
                  placeholder="Your name"
                  placeholderTextColor={colors.muted}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  style={{
                    alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: 10,
                    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
                    color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 12,
                  }}
                />
              )}

              <TextInput
                placeholder="Email address"
                placeholderTextColor={colors.muted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: 10,
                  paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
                  color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 12,
                }}
              />

              <TextInput
                placeholder="Password (min. 8 characters)"
                placeholderTextColor={colors.muted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                style={{
                  alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: 10,
                  paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
                  color: colors.foreground, borderWidth: 1, borderColor: colors.border, marginBottom: 16,
                }}
              />

              {error ? (
                <Text style={{ color: colors.error, fontSize: 13, marginBottom: 12, alignSelf: "flex-start" }}>{error}</Text>
              ) : null}

              <Pressable
                onPress={handleEmailAuth}
                disabled={loading}
                style={({ pressed }) => ({
                  alignSelf: "stretch", backgroundColor: loading ? colors.muted : colors.primary,
                  borderRadius: 12, paddingVertical: 15, alignItems: "center",
                  opacity: pressed ? 0.85 : 1, marginBottom: 16,
                })}
              >
                {loading ? (
                  <ActivityIndicator color={colors.background} size="small" />
                ) : (
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.background }}>
                    {mode === "login" ? "Sign In" : "Create Account"}
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={() => { setMode("choose"); setError(""); }}>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
                  ← Back
                </Text>
              </Pressable>

              {mode === "login" && (
                <Pressable onPress={() => { setMode("register"); setError(""); }} style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
                    No account? <Text style={{ color: colors.primary, fontWeight: "600" }}>Sign up</Text>
                  </Text>
                </Pressable>
              )}
            </>
          )}

          <Text style={{ marginTop: 24, fontSize: 11, color: colors.muted, textAlign: "center", lineHeight: 16 }}>
            Your videos and analyses are private{"\n"}and only visible to you and your coach.
          </Text>
        </ScrollView>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}
