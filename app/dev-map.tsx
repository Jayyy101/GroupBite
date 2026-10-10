import DevAppleMap from "@/components/dev-apple-map";
import { Redirect } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DevMapScreen() {
    if (!__DEV__) return <Redirect href="/" />;

    return (
        <SafeAreaView style={styles.screen}>
            <Text style={styles.title}>Apple Maps proof of concept</Text>
            <Text style={styles.description}>Development only. Pan, zoom, and tap the sample marker.</Text>
            <DevAppleMap />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: "#FFF8F0" },
    title: { paddingHorizontal: 16, paddingTop: 16, fontSize: 22, fontWeight: "600", color: "#2D1F1A" },
    description: { padding: 16, fontSize: 16, color: "#79665E" },
});
