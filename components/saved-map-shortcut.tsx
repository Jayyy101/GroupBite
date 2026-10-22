import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

export default function SavedMapShortcut() {
    const router = useRouter();
    if (!__DEV__ || Platform.OS !== "ios") return null;
    return <Pressable accessibilityRole="button" accessibilityLabel="Open Saved Map" accessibilityHint="Browse My Places and your groups on a map."
        onPress={() => router.push({ pathname: "/saved-map", params: { fromHome: "1" } }, { withAnchor: true })}
        style={({ pressed }) => [s.card, pressed && s.pressed]}>
        <View style={s.icon}><Ionicons name="map-outline" size={28} color="#A43922" accessible={false} /></View>
        <View style={s.body}><Text style={s.title}>Saved Map</Text><Text style={s.caption}>Explore My Places & your groups</Text></View>
        <Ionicons name="arrow-forward" size={21} color="#A43922" accessible={false} />
    </Pressable>;
}
const s = StyleSheet.create({
    card: { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: "#FFF0E3", borderWidth: 1,
        borderColor: "#DDB99D", borderRadius: 20, padding: 17, minHeight: 92 },
    icon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "#FFE1CB", alignItems: "center", justifyContent: "center" },
    body: { flex: 1, gap: 5 }, title: { color: "#39261C", fontWeight: "700", fontSize: 17 },
    caption: { color: "#6D4C3B", fontSize: 13, lineHeight: 19 }, pressed: { backgroundColor: "#FFE5D3" },
});
