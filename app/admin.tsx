/**
 * Admin screen — user management with role assignment.
 * Only accessible to users with role = "admin".
 */
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { trpc } from "@/lib/trpc";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuthContext } from "@/lib/auth-provider";

type Role = "user" | "coach" | "admin";

const ROLE_LABELS: Record<Role, string> = {
  user: "Player",
  coach: "Coach",
  admin: "Admin",
};

const ROLE_COLORS: Record<Role, string> = {
  user: "#687076",
  coach: "#0a7ea4",
  admin: "#8B5CF6",
};

export default function AdminScreen() {
  const colors = useColors();
  const { user } = useAuthContext();
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);

  const { data: users, isLoading, refetch } = trpc.admin.listUsers.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const updateRoleMutation = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      refetch();
      setUpdatingUserId(null);
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to update role");
      setUpdatingUserId(null);
    },
  });

  const handleRoleChange = (userId: number, newRole: Role, currentRole: Role) => {
    if (newRole === currentRole) return;
    const userName = users?.find((u) => u.id === userId)?.name || "this user";
    Alert.alert(
      "Change Role",
      `Set ${userName}'s role to ${ROLE_LABELS[newRole]}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            setUpdatingUserId(userId);
            updateRoleMutation.mutate({ userId, role: newRole });
          },
        },
      ]
    );
  };

  // Guard: only admins can access this screen
  if (!user || user.role !== "admin") {
    return (
      <ScreenContainer className="items-center justify-center px-8">
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🔒</Text>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>
          Admin Only
        </Text>
        <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginBottom: 24 }}>
          You don't have permission to access this page.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.background }}>Go Back</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ maxWidth: 800, width: "100%", alignSelf: "center", padding: 24 }}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12, padding: 4 }}>
              <Text style={{ fontSize: 24, color: colors.primary }}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}>
                User Management
              </Text>
              <Text style={{ fontSize: 13, color: colors.muted }}>
                Assign roles to control access
              </Text>
            </View>
            <View style={{
              backgroundColor: "#8B5CF620",
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}>
              <Text style={{ fontSize: 12, color: "#8B5CF6", fontWeight: "600" }}>Admin</Text>
            </View>
          </View>

          {/* Role legend */}
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            padding: 14,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: colors.border,
          }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 10 }}>
              Role Permissions
            </Text>
            <View style={{ gap: 6 }}>
              {(["user", "coach", "admin"] as Role[]).map((role) => (
                <View key={role} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{
                    width: 60,
                    backgroundColor: ROLE_COLORS[role] + "20",
                    borderRadius: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    alignItems: "center",
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: ROLE_COLORS[role] }}>
                      {ROLE_LABELS[role]}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }}>
                    {role === "user" && "Upload videos, view own analyses"}
                    {role === "coach" && "Add coach notes to any video"}
                    {role === "admin" && "Full access + user management"}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* User list */}
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : !users || users.length === 0 ? (
            <View style={{
              alignItems: "center",
              paddingVertical: 40,
              backgroundColor: colors.surface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 14, color: colors.muted }}>No users found</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 4 }}>
                {users.length} user{users.length !== 1 ? "s" : ""}
              </Text>
              {users.map((u) => {
                const role = (u.role as Role) ?? "user";
                const isCurrentUser = u.id === user.id;
                const isUpdating = updatingUserId === u.id;
                return (
                  <View
                    key={u.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderRadius: 14,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: isCurrentUser ? colors.primary + "40" : colors.border,
                    }}
                  >
                    {/* User info row */}
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                      <View style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: ROLE_COLORS[role] + "30",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 10,
                      }}>
                        <Text style={{ fontSize: 16, fontWeight: "700", color: ROLE_COLORS[role] }}>
                          {(u.name || u.email || "?").charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>
                            {u.name || "Unnamed User"}
                          </Text>
                          {isCurrentUser && (
                            <View style={{ backgroundColor: colors.primary + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, color: colors.primary, fontWeight: "600" }}>You</Text>
                            </View>
                          )}
                        </View>
                        {u.email ? (
                          <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{u.email}</Text>
                        ) : null}
                      </View>
                      {isUpdating && <ActivityIndicator size="small" color={colors.primary} />}
                    </View>

                    {/* Role selector */}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["user", "coach", "admin"] as Role[]).map((r) => (
                        <TouchableOpacity
                          key={r}
                          onPress={() => !isCurrentUser && handleRoleChange(u.id, r, role)}
                          disabled={isCurrentUser || isUpdating}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 10,
                            alignItems: "center",
                            backgroundColor: role === r ? ROLE_COLORS[r] + "20" : colors.background,
                            borderWidth: 1.5,
                            borderColor: role === r ? ROLE_COLORS[r] : colors.border,
                            opacity: isCurrentUser ? 0.5 : 1,
                          }}
                        >
                          <Text style={{
                            fontSize: 12,
                            fontWeight: role === r ? "700" : "500",
                            color: role === r ? ROLE_COLORS[r] : colors.muted,
                          }}>
                            {ROLE_LABELS[r]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {isCurrentUser && (
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6, textAlign: "center" }}>
                        You cannot change your own role
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
