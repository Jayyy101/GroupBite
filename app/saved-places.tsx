import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Place } from "../types/place";
import { getSavedPlaces } from "../utils/storage";

export default function SavedPlacesScreen() {
    const router = useRouter();
    const [places, setPlaces] = useState<Place[]>([]);

    useEffect(() => {
        async function loadPlaces() {
            const savedPlaces = await getSavedPlaces();
            setPlaces(savedPlaces);
        }

        loadPlaces();
    }, []);

    return (
        <View style={styles.screen}>
            <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={styles.backButton}
            >
                <Text style={styles.backButtonText}>Back</Text>
            </Pressable>

            <Text style={styles.title}>Saved Places</Text>

            {places.length === 0 && (
                <View style={styles.card}>
                    <Text style={styles.emptyMessage}>
                        No saved places yet. Add a place to start your list!
                    </Text>
                </View>
            )}

            {places.map((place) => (
                <View key={place.id} style={styles.card}>
                    <Text style={styles.placeName}>{place.name}</Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: "#FFF8F0",
        paddingTop: 60,
        paddingHorizontal: 24,
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
    emptyMessage: {
        color: "#79665E",
        fontSize: 16,
        lineHeight: 24,
    },
});
