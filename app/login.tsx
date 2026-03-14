import { View, Text, Pressable, ActivityIndicator, Image } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { startOAuthLogin } from "@/constants/oauth";
import { useState } from "react";

export default function LoginScreen() {
  const colors = useColors();
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await startOAuthLogin();
    } catch (e) {
      console.error("[Login] OAuth error:", e);
    } finally {
      // Don't reset loading — the page will redirect away
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} className="items-center justify-center px-8">
      {/* App icon */}
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 24,
          backgroundColor: colors.primary,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 16,
          elevation: 8,
        }}
      >
        <Text style={{ fontSize: 48 }}>🎾</Text>
      </View>

      {/* Title */}
      <Text
        style={{
          fontSize: 30,
          fontWeight: "800",
          color: colors.foreground,
          textAlign: "center",
          marginBottom: 8,
          letterSpacing: -0.5,
        }}
      >
        Squash Analyzer
      </Text>
      <Text
        style={{
          fontSize: 16,
          color: colors.muted,
          textAlign: "center",
          marginBottom: 48,
          lineHeight: 24,
        }}
      >
        AI-powered coaching insights{"\n"}from your match footage
      </Text>

      {/* Feature highlights */}
      {[
        { icon: "📊", label: "Game stats & shot breakdown" },
        { icon: "🧠", label: "Strategy analysis & weaknesses" },
        { icon: "🎯", label: "Top 4 improvement areas with drills" },
        { icon: "📈", label: "Progress tracking over time" },
      ].map((f) => (
        <View
          key={f.label}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            alignSelf: "stretch",
          }}
        >
          <Text style={{ fontSize: 20, width: 28, textAlign: "center" }}>{f.icon}</Text>
          <Text style={{ fontSize: 15, color: colors.muted, flex: 1 }}>{f.label}</Text>
        </View>
      ))}

      {/* Login button */}
      <Pressable
        onPress={handleLogin}
        disabled={loading}
        style={({ pressed }) => ({
          marginTop: 40,
          alignSelf: "stretch",
          backgroundColor: loading ? colors.muted : colors.primary,
          borderRadius: 14,
          paddingVertical: 16,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 10,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        {loading ? (
          <ActivityIndicator color={colors.background} size="small" />
        ) : (
          <Text style={{ fontSize: 17, fontWeight: "700", color: colors.background }}>
            Sign in to continue
          </Text>
        )}
      </Pressable>

      <Text
        style={{
          marginTop: 16,
          fontSize: 12,
          color: colors.muted,
          textAlign: "center",
          lineHeight: 18,
        }}
      >
        Your videos and analyses are private{"\n"}and only visible to you and your coach.
      </Text>
    </ScreenContainer>
  );
}
