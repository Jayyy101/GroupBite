import { savePlace } from "@/utils/storage";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
export default function AddPlaceScreen() {
    const router = useRouter();
    const [name, setName] = useState("");
    const [cuisine, setCuisine] = useState("");
    const [notes, setNotes] = useState("");
    const [error, setError] = useState("");

    async function handleSave() {
        if (name.trim() === "") {
            setError("Please enter a place name.");
            return;
        }

        setError("");
        try {
            await savePlace({
                id: Date.now().toString(),
                name: name.trim(),
                cuisine: cuisine.trim(),
                notes: notes.trim(),
            });
        } catch (error) {
            console.error("Failed to save place:", error);
            setError("Could not save the place. Please try again.");
            return;
        }

        router.replace("/saved-places");
    }

    return (
        <View style={styles.screen}>
            <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={styles.backButton}
            >
                <Text style={styles.backButtonText}>Back</Text>
            </Pressable>

            <Text style={styles.title}>Add a Place</Text>

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

            {error !== "" && <Text style={styles.error}>{error}</Text>}

            <Pressable
                accessibilityRole="button"
                onPress={handleSave}
                style={styles.saveButton}
            >
                <Text style={styles.saveButtonText}>Save Place</Text>
            </Pressable>
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
