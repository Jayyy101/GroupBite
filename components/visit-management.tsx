import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useIsFocused } from "@react-navigation/native";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { isVisitDate, visitManagementErrorMessage } from "@/lib/restaurant-ui";
import { isGroupAccessDenied } from "@/lib/group-errors";
import { accountAccessToken } from "@/lib/account-session";
import { withRequestDeadline } from "@/lib/request-deadline";
import { useAuth } from "@/providers/auth";
import { supabase } from "@/lib/supabase";
import { backendStyles as styles } from "@/styles/backend";
import type { GroupVisit, VisitScope } from "@/types/database";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type Props = {
    visit: GroupVisit;
    scope: VisitScope;
    action: "edit" | "delete";
    onCancel: () => void;
    onBusyChange: (busy: boolean) => void;
    onComplete: (entryRemoved: boolean) => void;
    onAccessDenied?: () => void;
    identity?: number;
};

export function VisitManagement(props: Props) {
    const controller = useVisitManagement(props);
    return <>{controller.confirmation}{controller.editor}</>;
}

// The restaurant route owns this hook above its disposable access-gated UI.
// Hiding private cards must not dispose an in-flight operation or its draft.
export function useVisitManagement(props: Props | null, { visible = true, canMutate = true } = {}) {
    const { session } = useAuth();
    const userId = session?.user.id;
    const visit = props?.visit, scope = props?.scope, action = props?.action;
    const key = JSON.stringify([userId, scope, visit?.id, action, props?.identity]);
    const identity = useRef({ key });
    if (identity.current.key !== key) identity.current = { key };
    const owner = identity.current;
    const [ready, setReady] = useState(owner);
    const [visitedOn, setVisitedOn] = useState(visit?.visited_on ?? "");
    const [rating, setRating] = useState(visit?.rating ?? null);
    const [wouldGoAgain, setWouldGoAgain] = useState(visit?.would_go_again ?? null);
    const [notes, setNotes] = useState(visit?.notes ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [uncertain, setUncertain] = useState(false);
    const submitting = useRef(false);
    const completed = useRef(false), uncertainRef = useRef(false);
    const mounted = useRef(true);
    const callbacks = useRef(props); callbacks.current = props;
    const focused = useIsFocused();
    const { isActive } = useForegroundRefresh();
    const availability = useRef({ visible: false, canMutate: false });
    availability.current = { visible: visible && focused && isActive && ready === owner, canMutate };
    const epoch = useRef(0);
    const leave = useLeaveGuard({ userId, resetKey: key, dirty: !!visit && ready === owner && action === "edit"
        && (visitedOn !== (visit.visited_on ?? "") || rating !== visit.rating
            || wouldGoAgain !== visit.would_go_again || notes !== (visit.notes ?? "")),
        busy: ready === owner && busy, uncertain: ready === owner && uncertain,
        uncertainExitMessage: "This change may already have been saved, or may still finish. Leaving stops this review; it does not undo the change. Check the group's saved visits before editing or deleting again. No mutation will be retried.",
        onDiscard: () => {
            completed.current = true; // Suppress retained handlers and late reads after deliberate abandonment.
            setVisitedOn(visit?.visited_on ?? ""); setRating(visit?.rating ?? null);
            setWouldGoAgain(visit?.would_go_again ?? null); setNotes(visit?.notes ?? "");
        } });

    useEffect(() => {
        mounted.current = true;
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") { epoch.current++; availability.current.visible = false; }
        });
        return () => { mounted.current = false; subscription.remove(); };
    }, []);
    useEffect(() => {
        if (!focused) { epoch.current++; availability.current.visible = false; }
    }, [focused]);
    useEffect(() => {
        setVisitedOn(visit?.visited_on ?? ""); setRating(visit?.rating ?? null);
        setWouldGoAgain(visit?.would_go_again ?? null); setNotes(visit?.notes ?? "");
        submitting.current = false; completed.current = false; uncertainRef.current = false;
        setBusy(false); setUncertain(false); setError(""); setReady(owner);
        // A new selection has a new identity; ordinary read refreshes do not reset it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [owner]);

    function current() { return mounted.current && identity.current === owner && !!callbacks.current; }
    function readable() { return current() && availability.current.visible && AppState.currentState === "active"; }
    function editable() { return readable() && availability.current.canMutate && !submitting.current && !uncertainRef.current && !completed.current; }
    function notifyBusy(value: boolean) { setBusy(value); callbacks.current?.onBusyChange(value); }

    async function handleSubmit() {
        if (!editable() || !scope || !action) return;
        setError("");
        if (action === "edit" && visitedOn.trim() !== "" && !isVisitDate(visitedOn.trim())) {
            setError("Enter a real visit date as YYYY-MM-DD, or leave it blank.");
            return;
        }
        submitting.current = true;
        notifyBusy(true);
        const started = epoch.current;
        let entryRemoved = false;
        let succeeded = false;
        let sent = false;
        let rejected = false;
        function editableBeforeSend() { return readable() && availability.current.canMutate && epoch.current === started; }
        try {
            const token = await withRequestDeadline(() => accountAccessToken(userId));
            if (!editableBeforeSend()) return;
            sent = true;
            if (action === "edit") {
                const result = await withRequestDeadline(signal => supabase.rpc("update_group_visit", {
                    ...scope,
                    visit_date: visitedOn.trim() || null,
                    visit_rating: rating,
                    visit_would_go_again: wouldGoAgain,
                    visit_notes: notes.trim() || null,
                }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
                if (result.error) { rejected = result.status >= 400 && result.status < 500 && !!result.error.code; throw result.error; }
            } else {
                const result = await withRequestDeadline(signal => supabase.rpc("delete_group_visit", scope).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
                if (result.error) { rejected = result.status >= 400 && result.status < 500 && !!result.error.code; throw result.error; }
                entryRemoved = result.data;
            }
            succeeded = true;
        } catch (error) {
            if (current()) {
                uncertainRef.current = sent && !rejected;
                setUncertain(uncertainRef.current);
                setError(visitManagementErrorMessage(error, action));
                if (isGroupAccessDenied(error)) callbacks.current?.onAccessDenied?.();
            }
        } finally {
            if (current()) { submitting.current = false; notifyBusy(false); }
        }
        if (succeeded && current()) {
            if (!readable() || epoch.current !== started) {
                uncertainRef.current = true; setUncertain(true);
                setError("Visit saved. Check Saved Visit after access is verified; this will not send another mutation.");
                return;
            }
            completed.current = true;
            leave.finish(() => callbacks.current?.onComplete(entryRemoved));
        }
    }

    async function checkSavedResult() {
        if (!readable() || !scope || !visit || submitting.current || completed.current) return;
        submitting.current = true; notifyBusy(true);
        const started = epoch.current;
        try {
            const token = await withRequestDeadline(() => accountAccessToken(userId));
            if (!readable() || epoch.current !== started) return;
            if (action === "delete") {
                const entries = await withRequestDeadline(signal => supabase.rpc("get_group_restaurants", { target_group_id: scope.target_group_id })
                    .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal));
                if (entries.error) throw entries.error;
                if (!readable() || epoch.current !== started) return;
                if (!entries.data.some(item => item.id === scope.target_group_restaurant_id)) {
                    completed.current = true;
                    leave.finish(() => callbacks.current?.onComplete(true));
                    return;
                }
            }
            const result = await withRequestDeadline(signal => supabase.rpc("get_group_restaurant_visits", {
                target_group_restaurant_id: scope.target_group_restaurant_id,
            }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal));
            if (result.error) throw result.error;
            if (!readable() || epoch.current !== started) return;
            const saved = result.data.find(item => item.id === visit.id);
            const confirmed = action === "delete" ? !saved : saved && saved.visited_on === (visitedOn.trim() || null)
                && saved.rating === rating && saved.would_go_again === wouldGoAgain && saved.notes === (notes.trim() || null);
            if (!confirmed) { setError("The saved result does not confirm this change yet. Check again before making another change."); return; }
            completed.current = true;
            // Parent refresh determines whether the entry still exists. Never
            // replay an update/delete merely because its response was lost.
            leave.finish(() => callbacks.current?.onComplete(false));
        } catch (error) {
            if (current()) {
                setError("Could not confirm the saved result. Check again when connected.");
                if (isGroupAccessDenied(error)) callbacks.current?.onAccessDenied?.();
            }
        } finally {
            if (current()) { submitting.current = false; notifyBusy(false); }
        }
    }

    const editor = !props || !visit || ready !== owner || !availability.current.visible ? null : (
        <View>
            <Text style={styles.label}>{action === "edit" ? "Edit Visit" : "Delete this Visit?"}</Text>
            {!canMutate && <Text style={styles.message}>This visit is no longer available to edit. Review the saved result or cancel this review.</Text>}
            {action === "edit" && canMutate ? (
                <>
                    <Text style={styles.label}>Visit date (optional)</Text>
                    <TextInput accessibilityLabel="Edit visit date" value={visitedOn} onChangeText={value => { if (editable()) setVisitedOn(value); }} maxLength={10} editable={canMutate && !busy && !uncertain} placeholder="YYYY-MM-DD" placeholderTextColor="#79665E" autoCorrect={false} style={styles.input} />
                    <Text style={styles.label}>Rating (optional, 1–5)</Text>
                    <View style={formStyles.row}>
                        {[1, 2, 3, 4, 5].map(value => (
                            <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Rating ${value} out of 5`} accessibilityState={{ selected: rating === value }} disabled={!canMutate || busy || uncertain} onPress={() => { if (editable()) setRating(rating === value ? null : value); }} style={[formStyles.choice, rating === value && formStyles.selected]}>
                                <Text style={rating === value ? styles.primaryText : styles.secondaryText}>{value}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <Text style={styles.label}>Would you go again? (optional)</Text>
                    <View style={formStyles.row}>
                        {[true, false].map(value => (
                            <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected: wouldGoAgain === value }} disabled={!canMutate || busy || uncertain} onPress={() => { if (editable()) setWouldGoAgain(wouldGoAgain === value ? null : value); }} style={[formStyles.choice, wouldGoAgain === value && formStyles.selected]}>
                                <Text style={wouldGoAgain === value ? styles.primaryText : styles.secondaryText}>{value ? "Yes" : "No"}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <Text style={styles.message}>Tap a selected choice again to leave it unanswered.</Text>
                    <Text style={styles.label}>Notes (optional)</Text>
                    <TextInput accessibilityLabel="Edit visit notes" value={notes} onChangeText={value => { if (editable()) setNotes(value); }} maxLength={4000} multiline editable={canMutate && !busy && !uncertain} placeholder="A memory from this visit" placeholderTextColor="#79665E" style={[styles.input, formStyles.notes]} />
                </>
            ) : action === "delete" ? (
                <Text style={styles.message}>This permanently deletes this visit from this group. If it is the final visit, the restaurant will also leave this group&apos;s list. Shared restaurant facts and other groups&apos; visits stay saved.</Text>
            ) : null}
            {error !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
            {uncertain && <Pressable accessibilityRole="button" disabled={busy} onPress={checkSavedResult} style={styles.secondaryButton}><Text style={styles.secondaryText}>Check Saved Visit</Text></Pressable>}
            <Pressable accessibilityRole="button" disabled={!canMutate || busy || uncertain} onPress={handleSubmit} style={[styles.primaryButton, busy && styles.disabled]}>
                <Text style={styles.primaryText}>{busy ? action === "edit" ? "Saving..." : "Deleting..." : action === "edit" ? "Save Changes" : "Confirm Delete Visit"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { if (readable()) leave.requestLeave(() => callbacks.current?.onCancel()); }} style={[styles.secondaryButton, busy && styles.disabled]}>
                <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
        </View>
    );
    // The warning contains no saved fields and remains reachable even when an
    // offline access check hides the editor. Inactivity still hides the modal.
    return { editor, confirmation: focused && isActive ? leave.confirmation : null };
}

const formStyles = StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    choice: { minWidth: 48, minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E85D3F", borderRadius: 12 },
    selected: { backgroundColor: "#E85D3F", borderColor: "#E85D3F" },
    notes: { minHeight: 112, textAlignVertical: "top" },
});
