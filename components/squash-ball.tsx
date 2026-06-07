import { View } from "react-native";

export function SquashBall({ size = 32 }: { size?: number }) {
  const dotSize = Math.round(size * 0.16);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#1a1a1a",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: Math.round(size * 0.12),
      }}
    >
      <View style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: "#FFD700" }} />
      <View style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: "#FFD700" }} />
    </View>
  );
}
