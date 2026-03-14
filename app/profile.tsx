import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuthContext } from "@/lib/auth-provider";

export default function ProfileScreen() {
  const colors = useColors();
  const { user, logout } = useAuthContext();

  const handleLogout = async () => {
    await logout();
    router.replace("/login" as any);
  };

  const initials = (user?.name || user?.email || "U").charAt(0).toUpperCase();
  const displayName = user?.name || user?.email || "Unknown User";
  const roleLabel = (user as any)?.role === "admin" ? "Admin" : "Player";

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ maxWidth: 600, width: "100%", alignSelf: "center", padding: 24 }}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 32 }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{ marginRight: 12, padding: 4 }}
            >
              <Text style={{ fontSize: 24, color: colors.primary }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}>
              Profile
            </Text>
          </View>

          {/* Avatar + name */}
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: colors.primary,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Text style={{ fontSize: 36, fontWeight: "700", color: colors.background }}>
                {initials}
              </Text>
            </View>
            <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
              {displayName}
            </Text>
            <View
              style={{
                backgroundColor: colors.primary + "20",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>
                {roleLabel}
              </Text>
            </View>
          </View>

          {/* Info card */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 24,
              overflow: "hidden",
            }}
          >
            {user?.email ? (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 14, color: colors.muted }}>Email</Text>
                <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>
                  {user.email}
                </Text>
              </View>
            ) : null}
            {user?.loginMethod ? (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 14, color: colors.muted }}>Login Method</Text>
                <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500", textTransform: "capitalize" }}>
                  {user.loginMethod}
                </Text>
              </View>
            ) : null}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 14, color: colors.muted }}>Last Sign In</Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>
                {user?.lastSignedIn ? new Date(user.lastSignedIn).toLocaleDateString() : "—"}
              </Text>
            </View>
          </View>

          {/* Admin panel link (only for admins) */}
          {(user as any)?.role === "admin" && (
            <TouchableOpacity
              onPress={() => router.push("/admin" as any)}
              style={{
                backgroundColor: "#8B5CF620",
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "#8B5CF640",
                marginBottom: 12,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: "#8B5CF6" }}>
                ⚙️ User Management
              </Text>
            </TouchableOpacity>
          )}

          {/* Sign out button */}
          <TouchableOpacity
            onPress={handleLogout}
            style={{
              backgroundColor: colors.error + "15",
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: "center",
              borderWidth: 1,
              borderColor: colors.error + "40",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.error }}>
              Sign Out
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
