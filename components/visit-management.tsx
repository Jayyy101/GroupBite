import { isVisitDate, visitManagementErrorMessage } from "@/lib/restaurant-ui";
import { isGroupAccessDenied } from "@/lib/group-errors";
import { supabase } from "@/lib/supabase";
import { backendStyles as styles } from "@/styles/backend";
import type { GroupVisit, VisitScope } from "@/types/database";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type Props = {
    visit: GroupVisit;
    scope: VisitScope;
    action: "edit" | "delete";
    onCancel: () => void;
    onBusyChange: (busy: boolean) => void;
    onComplete: (entryRemoved: boolean) => void;
    onAccessDenied?: () => void;
};

export function VisitManagement({ visit, scope, action, onCancel, onBusyChange, onComplete, onAccessDenied }: Props) {
    const [visitedOn, setVisitedOn] = useState(visit.visited_on ?? "");
    const [rating, setRating] = useState(visit.rating);
    const [wouldGoAgain, setWouldGoAgain] = useState(visit.would_go_again);
    const [notes, setNotes] = useState(visit.notes ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    async function handleSubmit() {
        if (submitting.current) return;
        setError("");
        if (action === "edit" && visitedOn.trim() !== "" && !isVisitDate(visitedOn.trim())) {
            setError("Enter a real visit date as YYYY-MM-DD, or leave it blank.");
            return;
        }
        submitting.current = true;
        setBusy(true);
        onBusyChange(true);
        let entryRemoved = false;
        let succeeded = false;
        try {
            if (action === "edit") {
                const result = await supabase.rpc("update_group_visit", {
                    ...scope,
                    visit_date: visitedOn.trim() || null,
                    visit_rating: rating,
                    visit_would_go_again: wouldGoAgain,
                    visit_notes: notes.trim() || null,
                });
                if (result.error) throw result.error;
            } else {
                const result = await supabase.rpc("delete_group_visit", scope);
                if (result.error) throw result.error;
                entryRemoved = result.data;
            }
            succeeded = true;
        } catch (error) {
            if (mounted.current) {
                setError(visitManagementErrorMessage(error, action));
                if (isGroupAccessDenied(error)) onAccessDenied?.();
            }
        } finally {
            submitting.current = false;
            if (mounted.current) {
                setBusy(false);
                onBusyChange(false);
            }
        }
        if (succeeded && mounted.current) onComplete(entryRemoved);
    }

    return (
        <View>
            <Text style={styles.label}>{action === "edit" ? "Edit Visit" : "Delete this Visit?"}</Text>
            {action === "edit" ? (
                <>
                    <Text style={styles.label}>Visit date (optional)</Text>
                    <TextInput accessibilityLabel="Edit visit date" value={visitedOn} onChangeText={setVisitedOn} maxLength={10} editable={!busy} placeholder="YYYY-MM-DD" placeholderTextColor="#79665E" autoCorrect={false} style={styles.input} />
                    <Text style={styles.label}>Rating (optional, 1–5)</Text>
                    <View style={formStyles.row}>
                        {[1, 2, 3, 4, 5].map(value => (
                            <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Rating ${value} out of 5`} accessibilityState={{ selected: rating === value }} disabled={busy} onPress={() => setRating(rating === value ? null : value)} style={[formStyles.choice, rating === value && formStyles.selected]}>
                                <Text style={rating === value ? styles.primaryText : styles.secondaryText}>{value}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <Text style={styles.label}>Would you go again? (optional)</Text>
                    <View style={formStyles.row}>
                        {[true, false].map(value => (
                            <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected: wouldGoAgain === value }} disabled={busy} onPress={() => setWouldGoAgain(wouldGoAgain === value ? null : value)} style={[formStyles.choice, wouldGoAgain === value && formStyles.selected]}>
                                <Text style={wouldGoAgain === value ? styles.primaryText : styles.secondaryText}>{value ? "Yes" : "No"}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <Text style={styles.message}>Tap a selected choice again to leave it unanswered.</Text>
                    <Text style={styles.label}>Notes (optional)</Text>
                    <TextInput accessibilityLabel="Edit visit notes" value={notes} onChangeText={setNotes} maxLength={4000} multiline editable={!busy} placeholder="A memory from this visit" placeholderTextColor="#79665E" style={[styles.input, formStyles.notes]} />
                </>
            ) : (
                <Text style={styles.message}>This permanently deletes this visit from this group. If it is the final visit, the restaurant will also leave this group&apos;s list. Shared restaurant facts and other groups&apos; visits stay saved.</Text>
            )}
            {error !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
            <Pressable accessibilityRole="button" disabled={busy} onPress={handleSubmit} style={[styles.primaryButton, busy && styles.disabled]}>
                <Text style={styles.primaryText}>{busy ? action === "edit" ? "Saving..." : "Deleting..." : action === "edit" ? "Save Changes" : "Confirm Delete Visit"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={[styles.secondaryButton, busy && styles.disabled]}>
                <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
        </View>
    );
}

const formStyles = StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    choice: { minWidth: 48, minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E85D3F", borderRadius: 12 },
    selected: { backgroundColor: "#E85D3F", borderColor: "#E85D3F" },
    notes: { minHeight: 112, textAlignVertical: "top" },
});
