import { getSavedPlaces, updatePlace } from "@/utils/storage";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
export default function AddPlaceScreen() {
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    if (id === undefined) return <Redirect href="/add-visit" />;
    return <LegacyPlaceEditor key={JSON.stringify(id)} id={id} />;
}

function LegacyPlaceEditor({ id }: { id: string | string[] }) {
    const router = useRouter();
    const [name, setName] = useState("");
    const [cuisine, setCuisine] = useState("");
    const [notes, setNotes] = useState("");
    const [rating, setRating] = useState<number | undefined>();
    const [wouldGoAgain, setWouldGoAgain] = useState<boolean | undefined>();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;

        async function loadPlace() {
            setLoading(true);
            setLoadError("");
            if (typeof id !== "string" || id.trim() === "") {
                setLoadError("This place could not be found.");
                setLoading(false);
                return;
            }

            try {
                const places = await getSavedPlaces();
                const place = places.find((item) => item.id === id);
                if (!active) return;

                if (!place) {
                    setLoadError("This place could not be found.");
                    return;
                }

                setName(place.name);
                setCuisine(place.cuisine ?? "");
                setNotes(place.notes ?? "");
                setRating(place.rating);
                setWouldGoAgain(place.wouldGoAgain);
            } catch (error) {
                console.error("Failed to load place for editing:", error);
                if (active) setLoadError("Could not load this place. Please try again.");
            } finally {
                if (active) setLoading(false);
            }
        }

        loadPlace();
        return () => {
            active = false;
        };
    }, [id]);

    async function handleSave() {
        if (typeof id !== "string" || loading || loadError !== "" || saving) return;

        if (name.trim() === "") {
            setError("Please enter a place name.");
            return;
        }

        setError("");
        setSaving(true);
        try {
            const place = {
                id,
                name: name.trim(),
                cuisine: cuisine.trim(),
                notes: notes.trim(),
                rating,
                wouldGoAgain,
            };
            await updatePlace(place);
        } catch (error) {
            console.error("Failed to save place:", error);
            setError("Could not save the place. Please try again.");
            return;
        } finally {
            setSaving(false);
        }

        router.dismissTo({ pathname: "/place/[id]", params: { id } });
    }

    return (
        <ScrollView
            style={styles.screen}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
        >
            <Pressable
                accessibilityRole="button"
                disabled={saving}
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

            <Text style={styles.title}>Edit Place</Text>

            {loading ? (
                <Text style={styles.choiceHint}>Loading place...</Text>
            ) : loadError !== "" ? (
                <Text style={styles.error}>{loadError}</Text>
            ) : (
                <View>
                    <TextInput
                        value={name}
                        onChangeText={setName}
                        placeholder="Enter a name"
                        placeholderTextColor="#79665E"
                        style={styles.input}
                    />

                    <TextInput
                        value={cuisine}
                        onChangeText={setCuisine}
                        placeholder="Cuisine (optional)"
                        placeholderTextColor="#79665E"
                        style={[styles.input, styles.optionalInput]}
                    />

                    <TextInput
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="Notes (optional)"
                        placeholderTextColor="#79665E"
                        multiline
                        style={[styles.input, styles.optionalInput, styles.notesInput]}
                    />

                    <Text style={styles.choiceLabel}>Rating (optional, 1–5)</Text>
                    <View style={styles.choiceRow}>
                        {[1, 2, 3, 4, 5].map((value) => (
                            <Pressable
                                key={value}
                                accessibilityRole="button"
                                accessibilityLabel={`Rating ${value} out of 5`}
                                accessibilityState={{ selected: rating === value }}
                                onPress={() => setRating(rating === value ? undefined : value)}
                                style={[styles.choiceButton, rating === value && styles.selectedChoice]}
                            >
                                <Text style={[styles.choiceText, rating === value && styles.selectedChoiceText]}>
                                    {value}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    <Text style={styles.choiceLabel}>Would you go again? (optional)</Text>
                    <View style={styles.choiceRow}>
                        {[true, false].map((value) => (
                            <Pressable
                                key={String(value)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: wouldGoAgain === value }}
                                onPress={() => setWouldGoAgain(wouldGoAgain === value ? undefined : value)}
                                style={[styles.choiceButton, wouldGoAgain === value && styles.selectedChoice]}
                            >
                                <Text style={[styles.choiceText, wouldGoAgain === value && styles.selectedChoiceText]}>
                                    {value ? "Yes" : "No"}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <Text style={styles.choiceHint}>Tap a selected choice again to clear it.</Text>

                    {error !== "" && <Text style={styles.error}>{error}</Text>}

                    <Pressable
                        accessibilityRole="button"
                        onPress={handleSave}
                        disabled={saving}
                        style={styles.saveButton}
                    >
                        <Text style={styles.saveButtonText}>
                            {saving ? "Saving..." : "Save Changes"}
                        </Text>
                    </Pressable>
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
    input: {
        backgroundColor: "#FFFFFF",
        color: "#2D1F1A",
        borderWidth: 1,
        borderColor: "#BFA99B",
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 17,
    },
    optionalInput: {
        marginTop: 16,
    },
    notesInput: {
        minHeight: 112,
        textAlignVertical: "top",
    },
    choiceLabel: {
        color: "#2D1F1A",
        fontSize: 17,
        fontWeight: "600",
        marginTop: 20,
        marginBottom: 12,
    },
    choiceRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    choiceButton: {
        minWidth: 48,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#BFA99B",
        borderRadius: 12,
    },
    selectedChoice: {
        backgroundColor: "#E85D3F",
        borderColor: "#E85D3F",
    },
    choiceText: {
        color: "#2D1F1A",
        fontSize: 17,
        fontWeight: "600",
    },
    selectedChoiceText: {
        color: "#FFFFFF",
    },
    choiceHint: {
        color: "#79665E",
        fontSize: 14,
        marginTop: 12,
    },
    error: {
        color: "#B42318",
        fontSize: 15,
        marginTop: 12,
    },
    saveButton: {
        backgroundColor: "#E85D3F",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 56,
        paddingVertical: 16,
        borderRadius: 14,
        marginTop: 24,
    },
    saveButtonText: {
        color: "#FFFFFF",
        fontSize: 17,
        fontWeight: "600",
    },
});
