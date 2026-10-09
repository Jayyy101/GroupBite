import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlaceFields as Fields } from "@/types/database";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

// Uses the existing restaurant/Visit controls and styling without refactoring
// the already-tested group form or its membership/submission lifecycle.
export function PersonalPlaceFields({ value, onChange, busy }: { value: Fields; onChange: (value: Fields) => void; busy: boolean }) {
    function change<K extends keyof Fields>(key: K, next: Fields[K]) { onChange({ ...value, [key]: next }); }
    return (
        <View>
            <Text style={styles.label}>Restaurant name</Text>
            <TextInput accessibilityLabel="Restaurant name" value={value.name} onChangeText={text => change("name", text)} maxLength={100} editable={!busy} placeholder="Restaurant name" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.label}>Address</Text>
            <TextInput accessibilityLabel="Restaurant address" value={value.address} onChangeText={text => change("address", text)} maxLength={300} editable={!busy} placeholder="Full address, including city" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.label}>Cuisine (optional)</Text>
            <TextInput accessibilityLabel="Cuisine" value={value.cuisine ?? ""} onChangeText={text => change("cuisine", text)} maxLength={100} editable={!busy} placeholder="Cuisine" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.label}>Visit date (optional)</Text>
            <TextInput accessibilityLabel="Visit date" value={value.visited_on ?? ""} onChangeText={text => change("visited_on", text)} maxLength={10} editable={!busy} placeholder="YYYY-MM-DD" placeholderTextColor="#79665E" autoCorrect={false} style={styles.input} />
            <Text style={styles.label}>Rating (optional, 1–5)</Text>
            <View style={formStyles.row}>
                {[1, 2, 3, 4, 5].map(rating => <Pressable key={rating} accessibilityRole="button" accessibilityLabel={`Rating ${rating} out of 5`} accessibilityState={{ selected: value.rating === rating }} disabled={busy} onPress={() => change("rating", value.rating === rating ? null : rating)} style={[formStyles.choice, value.rating === rating && formStyles.selected]}>
                    <Text style={value.rating === rating ? styles.primaryText : styles.secondaryText}>{rating}</Text>
                </Pressable>)}
            </View>
            <Text style={styles.label}>Would you go again? (optional)</Text>
            <View style={formStyles.row}>
                {[true, false].map(answer => <Pressable key={String(answer)} accessibilityRole="button" accessibilityState={{ selected: value.would_go_again === answer }} disabled={busy} onPress={() => change("would_go_again", value.would_go_again === answer ? null : answer)} style={[formStyles.choice, value.would_go_again === answer && formStyles.selected]}>
                    <Text style={value.would_go_again === answer ? styles.primaryText : styles.secondaryText}>{answer ? "Yes" : "No"}</Text>
                </Pressable>)}
            </View>
            <Text style={styles.message}>Tap a selected choice again to leave it unanswered.</Text>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput accessibilityLabel="Personal notes" value={value.notes ?? ""} onChangeText={text => change("notes", text)} maxLength={4000} multiline editable={!busy} placeholder="A personal memory" placeholderTextColor="#79665E" style={[styles.input, formStyles.notes]} />
        </View>
    );
}

const formStyles = StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    choice: { minWidth: 48, minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E85D3F", borderRadius: 12 },
    selected: { backgroundColor: "#E85D3F", borderColor: "#E85D3F" },
    notes: { minHeight: 112, textAlignVertical: "top" },
});
