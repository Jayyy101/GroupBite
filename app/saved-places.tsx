import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Place } from "../types/place";
import { getSavedPlaces } from "../utils/storage";

export default function SavedPlacesScreen() {
    const router = useRouter();
    const [places, setPlaces] = useState<Place[]>([]);
    const [error, setError] = useState("");

    useFocusEffect(useCallback(() => {
        let active = true;
        async function loadPlaces() {
            try {
                const savedPlaces = await getSavedPlaces();
                if (active) {
                    setPlaces(savedPlaces);
                    setError("");
                }
            } catch (error) {
                console.error("Failed to load saved places:", error);
                if (active) setError("Could not load saved places. Please try again.");
            }
        }

        loadPlaces();
        return () => {
            active = false;
        };
    }, []));

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={styles.backButton}
            >
                <Text style={styles.backButtonText}>Back</Text>
            </Pressable>

            <Text style={styles.title}>Saved Places (this device)</Text>

            {error !== "" && <Text style={styles.error}>{error}</Text>}

            {error === "" && places.length === 0 && (
                <View style={styles.card}>
                    <Text style={styles.emptyMessage}>
                        No previously saved Places on this device. Restaurant visits are saved to your groups; My Places saves private memories to your account.
                    </Text>
                </View>
            )}

            {places.map((place) => (
                <Pressable
                    key={place.id}
                    accessibilityRole="button"
                    onPress={() => router.push({
                        pathname: "/place/[id]",
                        params: { id: place.id },
                    })}
                    style={styles.card}
                >
                    <Text style={styles.placeName}>{place.name}</Text>
                </Pressable>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: "#FFF8F0",
    },
    content: {
        paddingTop: 60,
        paddingHorizontal: 24,
        paddingBottom: 32,
    },
    backButton: {
        alignSelf: "flex-start",
        justifyContent: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: "#E85D3F",
        borderRadius: 12,
        marginBottom: 24,
    },
    backButtonText: {
        color: "#C9472C",
        fontSize: 16,
        fontWeight: "600",
    },
    title: {
        color: "#2D1F1A",
        fontSize: 30,
        fontWeight: "700",
        marginBottom: 24,
    },
    card: {
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#BFA99B",
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    placeName: {
        color: "#2D1F1A",
        fontSize: 17,
        fontWeight: "600",
    },
    error: {
        color: "#B42318",
        fontSize: 16,
        marginBottom: 16,
    },
    emptyMessage: {
        color: "#79665E",
        fontSize: 16,
        lineHeight: 24,
    },
});
