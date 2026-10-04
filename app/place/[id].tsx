import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Place } from "../../types/place";
import { getSavedPlaces } from "../../utils/storage";

export default function PlaceDetailScreen() {
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    const [place, setPlace] = useState<Place | undefined>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

        async function loadPlace() {
            setLoading(true);
            setPlace(undefined);
            setError("");

            if (typeof id !== "string" || id.trim() === "") {
                setError("This place could not be found.");
                setLoading(false);
                return;
            }

            try {
                const savedPlaces = await getSavedPlaces();
                const selectedPlace = savedPlaces.find((item) => item.id === id);

                if (active) {
                    setPlace(selectedPlace);
                    if (!selectedPlace) {
                        setError("This place could not be found.");
                    }
                }
            } catch (error) {
                console.error("Failed to load place:", error);
                if (active) {
                    setError("Could not load this place. Please try again.");
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        }

        loadPlace();

        return () => {
            active = false;
        };
    }, [id]);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable
                accessibilityRole="button"
                onPress={() => {
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        router.replace("/saved-places");
                    }
                }}
                style={styles.backButton}
            >
                <Text style={styles.backButtonText}>Back</Text>
            </Pressable>

            {loading ? (
                <Text style={styles.message}>Loading place...</Text>
            ) : error !== "" ? (
                <Text style={styles.error}>{error}</Text>
            ) : (
                <View>
                    <Text style={styles.title}>{place?.name}</Text>

                    {!!place?.cuisine?.trim() && (
                        <View style={styles.detailSection}>
                            <Text style={styles.label}>Cuisine</Text>
                            <Text style={styles.message}>{place.cuisine}</Text>
                        </View>
                    )}

                    {!!place?.notes?.trim() && (
                        <View style={styles.detailSection}>
                            <Text style={styles.label}>Notes</Text>
                            <Text style={styles.message}>{place.notes}</Text>
                        </View>
                    )}

                    {place?.rating !== undefined && (
                        <View style={styles.detailSection}>
                            <Text style={styles.label}>Rating</Text>
                            <Text style={styles.message}>{place.rating} / 5</Text>
                        </View>
                    )}

                    {typeof place?.wouldGoAgain === "boolean" && (
                        <View style={styles.detailSection}>
                            <Text style={styles.message}>
                                Would go again: {place.wouldGoAgain ? "Yes" : "No"}
                            </Text>
                        </View>
                    )}
                </View>
            )}
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
    detailSection: {
        marginBottom: 20,
    },
    label: {
        color: "#2D1F1A",
        fontSize: 17,
        fontWeight: "600",
        marginBottom: 8,
    },
    message: {
        color: "#79665E",
        fontSize: 16,
        lineHeight: 24,
    },
    error: {
        color: "#B42318",
        fontSize: 16,
        lineHeight: 24,
    },
});
