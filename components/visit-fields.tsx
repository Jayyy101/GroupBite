import { backendStyles as styles } from "@/styles/backend";
import { VisitDateField } from "@/components/visit-date-field";
import type { PersonalPlaceFields } from "@/types/database";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export type VisitFieldsValue = Pick<PersonalPlaceFields, "visited_on" | "rating" | "would_go_again" | "notes">;
export function VisitFields({ value, onChange, disabled, notesLabel = "Private notes" }: {
    value: VisitFieldsValue; onChange: (value: VisitFieldsValue) => void; disabled: boolean; notesLabel?: string;
}) {
    return <View>
        <VisitDateField value={value.visited_on} disabled={disabled} onChange={visited_on => onChange({ ...value, visited_on })} />
        <Text style={styles.label}>Rating (optional, 1–5)</Text>
        <View style={formStyles.row}>
            {[1, 2, 3, 4, 5].map(rating => <Pressable key={rating} accessibilityRole="button" accessibilityLabel={`Rating ${rating} out of 5`}
                accessibilityState={{ selected: value.rating === rating }} disabled={disabled} style={[formStyles.choice, value.rating === rating && formStyles.selected]}
                onPress={() => onChange({ ...value, rating: value.rating === rating ? null : rating })}><Text style={value.rating === rating ? styles.primaryText : styles.secondaryText}>{rating}</Text></Pressable>)}
        </View>
        <Text style={styles.label}>Would you go again? (optional)</Text>
        <View style={formStyles.row}>
            {[true, false].map(again => <Pressable key={String(again)} accessibilityRole="button" accessibilityState={{ selected: value.would_go_again === again }}
                disabled={disabled} style={[formStyles.choice, value.would_go_again === again && formStyles.selected]}
                onPress={() => onChange({ ...value, would_go_again: value.would_go_again === again ? null : again })}>
                <Text style={value.would_go_again === again ? styles.primaryText : styles.secondaryText}>{again ? "Yes" : "No"}</Text></Pressable>)}
        </View>
        <Text style={styles.message}>Tap a selected choice again to leave it unanswered.</Text>
        <Text style={styles.label}>{notesLabel} (optional)</Text>
        <TextInput accessibilityLabel={notesLabel} style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]} multiline
            value={value.notes ?? ""} editable={!disabled} maxLength={4000} onChangeText={notes => onChange({ ...value, notes: notes || null })} />
    </View>;
}

const formStyles = StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    choice: { minWidth: 48, minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E85D3F", borderRadius: 12 },
    selected: { backgroundColor: "#E85D3F", borderColor: "#E85D3F" },
});
