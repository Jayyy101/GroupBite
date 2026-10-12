import DevAppleMap from "@/components/dev-apple-map";
import { PersonalAccess } from "@/components/personal-access";
import { listPersonalMapPins, personalMapErrorMessage, type PersonalMapPin } from "@/lib/personal-map";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DevMapScreen() {
    if (!__DEV__) return <Redirect href="/" />;
    return <PersonalAccess title="My Places Map">{userId => <PersonalPlacesMap key={userId} userId={userId} />}</PersonalAccess>;
}

function PersonalPlacesMap({ userId }: { userId: string }) {
    const router = useRouter();
    const [pins, setPins] = useState<PersonalMapPin[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        if (Platform.OS !== "ios") { setLoading(false); return; }
        let active = true;
        const controller = new AbortController();
        setPins([]); setLoading(true); setError("");
        listPersonalMapPins(userId, controller.signal).then(data => { if (active) setPins(data); })
            .catch(error => { if (active) setError(personalMapErrorMessage(error)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; controller.abort(); };
    }, [userId, refresh]);
    return (
        <SafeAreaView style={styles.screen}>
            <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/my-places")} style={styles.button}>
                <Text style={styles.buttonText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>My Places Map</Text>
            <Text style={styles.description}>Development only. Your resolved personal Places. Pan, zoom, and tap a pin for its name and address.</Text>
            {Platform.OS !== "ios" ? <DevAppleMap pins={[]} /> : loading ? <Text style={styles.description}>Loading your map...</Text>
                : error !== "" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
                : pins.length === 0 ? <Text style={styles.description}>No resolved personal Places to map yet. Manually saved addresses remain in My Places.</Text>
                : <DevAppleMap key={refresh} pins={pins} />}
            {Platform.OS === "ios" && <Pressable accessibilityRole="button" disabled={loading} onPress={() => setRefresh(value => value + 1)} style={styles.button}>
                <Text style={styles.buttonText}>Refresh Map</Text>
            </Pressable>}
            {Platform.OS === "ios" && <Pressable accessibilityRole="button" onPress={() => router.push("/dev-apple-search")} style={styles.button}>
                <Text style={styles.buttonText}>Try Apple Maps Search</Text>
            </Pressable>}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: "#FFF8F0" },
    title: { paddingHorizontal: 16, paddingTop: 16, fontSize: 22, fontWeight: "600", color: "#2D1F1A" },
    description: { padding: 16, fontSize: 16, color: "#79665E" },
    error: { padding: 16, fontSize: 16, color: "#B42318" },
    button: { padding: 16 },
    buttonText: { fontSize: 16, fontWeight: "600", color: "#C9472C" },
});
