import { accountAccessToken } from "@/lib/account-session";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import ApplePlacePicker from "@/components/personal-apple-place-picker";
import { freezeGroupVisitSubmission, sendGroupVisitSubmission, isDefinitiveVisitRejection,
    type GroupVisitSubmission } from "@/lib/group-visit-save";
import type { AddressSuggestion } from "@/lib/address-search";
import { isUuid, isVisitDate, restaurantErrorMessage } from "@/lib/restaurant-ui";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useAddressSearch } from "@/hooks/use-address-search";
import { isGroupAccessDenied } from "@/lib/group-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { Group, SaveVisitArgs } from "@/types/database";
import { useIsFocused, useNavigation, usePreventRemove } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

export default function AddVisitScreen() {
    const router = useRouter();
    const { groupId, restaurantId } = useLocalSearchParams<{ groupId?: string; restaurantId?: string }>();
    const { session, loading } = useAuth();
    if (!loading && session) {
        return <VisitForm key={`${session.user.id}:${groupId}:${restaurantId}`} userId={session.user.id} groupId={groupId} restaurantId={restaurantId} />;
    }
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/groups")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>Add Restaurant / Visit</Text>
            <Text style={styles.message}>{loading ? "Restoring your session..." : "Sign in to save a restaurant visit to your groups."}</Text>
            {!loading && (
                <Pressable accessibilityRole="button" onPress={() => router.push("/auth")} style={styles.primaryButton}>
                    <Text style={styles.primaryText}>Sign In / Sign Up</Text>
                </Pressable>
            )}
        </ScrollView>
    );
}

function VisitForm({ userId, groupId, restaurantId }: { userId: string; groupId?: string; restaurantId?: string }) {
    const router = useRouter();
    const navigation = useNavigation();
    const { session, loading: accountLoading } = useAuth();
    const currentAccount = useRef(false);
    currentAccount.current = !accountLoading && session?.user.id === userId;
    const autocomplete = useAddressSearch();
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    // Kept separately from the unchanged save RPC payload; discarded on lifecycle resets.
    const [addressSelection, setAddressSelection] = useState<AddressSuggestion | null>(null);
    const [cuisine, setCuisine] = useState("");
    const [visitedOn, setVisitedOn] = useState("");
    const [rating, setRating] = useState<number | null>(null);
    const [wouldGoAgain, setWouldGoAgain] = useState<boolean | null>(null);
    const [notes, setNotes] = useState("");
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroups, setSelectedGroups] = useState<string[]>(isUuid(groupId) ? [groupId] : []);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const lastSubmission = useRef<GroupVisitSubmission | null>(null);
    const [submissionLocked, setSubmissionLocked] = useState(false);
    const [completed, setCompleted] = useState(false);
    const completedRef = useRef(false), uncertain = useRef(false);
    const lifecycleEpoch = useRef(0);
    const savedRestaurantId = useRef<string | null>(null), resolvingDestination = useRef(false);
    const appleSelection = useRef<{ id: string; address: string } | null>(null);
    const [appleReset, setAppleReset] = useState(0);
    const [confirmLeaving, setConfirmLeaving] = useState(false);
    const [allowLeave, setAllowLeave] = useState(false);
    const pendingLeave = useRef<(() => void) | null>(null);
    const abandoning = useRef(false);
    const locked = saving || submissionLocked;
    const dirty = (restaurantId === undefined && (name !== "" || address !== "" || cuisine !== ""))
        || visitedOn !== "" || rating !== null || wouldGoAgain !== null || notes !== ""
        || (!loading && JSON.stringify([...selectedGroups].sort()) !== JSON.stringify(isUuid(groupId) && groups.some(group => group.id === groupId) ? [groupId] : []));
    const saveWarning = saving || submissionLocked;
    const destinationAccessKey = groups.filter(group => selectedGroups.includes(group.id))
        .map(group => `${group.id}:${group.owner_user_id}`).sort().join(",");
    const mounted = useRef(false), submitting = useRef(false), visible = useRef(false);
    const isFocused = useIsFocused();
    const { version: foregroundVersion, isActive } = useForegroundRefresh();

    // Native-stack uses this hook to prevent iOS gesture dismissal as well as
    // JS removal actions. Account replacement/sign-out disposes the keyed form.
    usePreventRemove(currentAccount.current && !allowLeave && !completed
        && (saving || submissionLocked || dirty), ({ data }) => {
        requestLeave(() => navigation.dispatch(data.action));
    });

    useEffect(() => {
        if (!allowLeave || !mounted.current || !currentAccount.current) return;
        const leave = pendingLeave.current;
        pendingLeave.current = null;
        leave?.();
    }, [allowLeave]);

    function requestLeave(leave: () => void) {
        if (!mounted.current || abandoning.current) return;
        if (!currentAccount.current || completedRef.current || (!submitting.current && !lastSubmission.current && !dirty)) {
            leave();
            return;
        }
        if (pendingLeave.current) return;
        pendingLeave.current = leave;
        setConfirmLeaving(true);
    }

    function stayOnSave() {
        if (!mounted.current) return;
        pendingLeave.current = null;
        setConfirmLeaving(false);
    }

    function leaveAnyway() {
        if (!mounted.current || !currentAccount.current || !pendingLeave.current) return;
        // Prevent a late save result from racing the deliberate navigation.
        abandoning.current = true;
        setConfirmLeaving(false);
        setAllowLeave(true);
    }

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        visible.current = isFocused && isActive;
        if (!isFocused) lifecycleEpoch.current++;
        return () => { visible.current = false; };
    }, [isFocused, isActive]);

    useEffect(() => {
        setAddressSelection(null);
        appleSelection.current = null; setAppleReset(value => value + 1);
    }, [isFocused, isActive, foregroundVersion, refreshVersion]);

    useEffect(() => {
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") { lifecycleEpoch.current++; appleSelection.current = null; setAppleReset(value => value + 1); }
        });
        return () => subscription.remove();
    }, []);

    useEffect(() => { appleSelection.current = null; setAppleReset(value => value + 1); }, [selectedGroups, destinationAccessKey, loadError]);

    useEffect(() => {
        setGroups([]);
        setLoading(true);
        if (!isFocused || !isActive) return;
        let active = true;
        let pending = false;
        let restaurantLoaded = restaurantId === undefined;
        async function loadForm(includeRestaurant = false) {
            if (pending) return;
            pending = true;
            setLoadError("");
            try {
                const result = await supabase.from("groups").select("*").order("name");
                if (result.error) throw result.error;
                if (!active) return;
                setGroups(result.data);
                setSelectedGroups(selected => {
                    const next = selected.filter(id => result.data.some(group => group.id === id));
                    return next.length === selected.length ? selected : next;
                });
                if ((includeRestaurant || !restaurantLoaded) && restaurantId !== undefined) {
                    if (!isUuid(restaurantId)) throw new Error("Invalid restaurant");
                    const restaurant = await supabase.from("restaurants").select("*").eq("id", restaurantId).single();
                    if (restaurant.error) throw restaurant.error;
                    if (active && !lastSubmission.current) {
                        setName(restaurant.data.name);
                        setAddress(restaurant.data.address);
                        setCuisine(restaurant.data.cuisine ?? "");
                        restaurantLoaded = true;
                    }
                }
            } catch {
                if (active) {
                    setGroups([]);
                    setLoadError("Could not load groups or restaurant details. Check your connection and refresh.");
                }
            } finally {
                pending = false;
                if (active) setLoading(false);
            }
        }
        loadForm(true);
        const timer = setInterval(() => { loadForm(); }, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [restaurantId, refreshVersion, isFocused, isActive, foregroundVersion]);

    async function handleSave() {
        if (!mounted.current || abandoning.current || !visible.current || AppState.currentState !== "active" || submitting.current || saving || completedRef.current || (!lastSubmission.current && (loading || loadError !== ""))) return;
        setError("");
        if (!lastSubmission.current && (!name.trim() || !address.trim())) {
            setError("Please enter a restaurant name and address.");
            return;
        }
        if (!lastSubmission.current && visitedOn.trim() !== "" && !isVisitDate(visitedOn.trim())) {
            setError("Enter a real visit date as YYYY-MM-DD, or leave it blank.");
            return;
        }
        if (!lastSubmission.current && selectedGroups.length === 0) {
            setError("Please choose at least one group.");
            return;
        }
        const details: Omit<SaveVisitArgs, "client_request_id"> = {
            target_group_ids: [...selectedGroups].sort(),
            restaurant_name: name.trim(),
            restaurant_address: address.trim(),
            restaurant_cuisine: cuisine.trim() || null,
            visit_date: visitedOn.trim() || null,
            visit_rating: rating,
            visit_would_go_again: wouldGoAgain,
            visit_notes: notes.trim() || null,
        };
        const epoch = lifecycleEpoch.current;
        const retryingUncertainSave = uncertain.current;
        const submission = lastSubmission.current ?? freezeGroupVisitSubmission(userId, details,
            __DEV__ && appleSelection.current?.address === address ? appleSelection.current.id : undefined);
        lastSubmission.current = submission;
        appleSelection.current = null;
        setSubmissionLocked(true);
        submitting.current = true;
        setSaving(true);
        try {
            const sent = await sendGroupVisitSubmission(submission, () => mounted.current && !abandoning.current && visible.current && lifecycleEpoch.current === epoch && AppState.currentState === "active");
            if (!mounted.current || abandoning.current) return;
            if (!sent) { setError("Save paused before sending. Retry this same submission when this screen is active."); return; }
            savedRestaurantId.current = sent;
            completedRef.current = true; setCompleted(true); uncertain.current = false;
            pendingLeave.current = null; setConfirmLeaving(false);
        } catch (error) {
            if (!mounted.current || abandoning.current) return;
            if (!retryingUncertainSave && isDefinitiveVisitRejection(error)) {
                lastSubmission.current = null; setSubmissionLocked(false);
                pendingLeave.current = null; setConfirmLeaving(false);
                const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
                setError(typeof code === "string" && ["40P01", "40001", "57014"].includes(code)
                    ? "This attempt was rolled back without saving a visit. You can correct the fields and save again."
                    : restaurantErrorMessage(error));
            } else {
                uncertain.current = true;
                setError("The save result is uncertain. Your submission is locked. Retry the same save to confirm it without adding duplicate visits.");
            }
            if (isGroupAccessDenied(error)) {
                setGroups([]);
                setRefreshVersion(value => value + 1);
            }
            return;
        } finally {
            submitting.current = false;
            if (mounted.current) setSaving(false);
        }
        if (!mounted.current || abandoning.current || lifecycleEpoch.current !== epoch || !visible.current || AppState.currentState !== "active") return;
        await finishSubmission();
    }

    async function finishSubmission() {
        const destination = lastSubmission.current?.args.target_group_ids;
        if (!completedRef.current || !destination || !mounted.current || abandoning.current || resolvingDestination.current || !visible.current || AppState.currentState !== "active") return;
        if (destination.length !== 1) {
            router.dismissTo("/groups", { withAnchor: true });
            return;
        }
        resolvingDestination.current = true;
        const epoch = lifecycleEpoch.current;
        try {
            // Save RPCs return the shared restaurant ID. Resolve the group entry
            // with an authorized read; it is never interchangeable with entryId.
            const token = await accountAccessToken(userId);
            if (!mounted.current || abandoning.current) return;
            const result = await supabase.rpc("get_group_restaurants", { target_group_id: destination[0] })
                .setHeader("Authorization", `Bearer ${token}`);
            if (result.error) throw result.error;
            if (!mounted.current || abandoning.current || !currentAccount.current || lifecycleEpoch.current !== epoch || !visible.current || AppState.currentState !== "active") return;
            const entry = result.data.find(item => item.restaurant_id === savedRestaurantId.current);
            if (!entry) throw new Error("Saved entry is unavailable");
            router.dismissTo({ pathname: "/group/[id]/restaurant/[entryId]", params: { id: destination[0], entryId: entry.id } }, { withAnchor: true });
        } catch {
            if (mounted.current && !abandoning.current) setError("Visit saved. Could not open its history. Continue to Groups to check again; this will not save another visit.");
        } finally { resolvingDestination.current = false; }
    }

    const existingRestaurant = restaurantId !== undefined;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Pressable accessibilityRole="button" onPress={() => requestLeave(() => router.canGoBack() ? router.back() : router.replace("/groups"))} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            {confirmLeaving && <Modal visible transparent animationType="fade" onRequestClose={stayOnSave}>
                <View style={formStyles.confirmationOverlay}>
                    <View accessibilityViewIsModal style={[styles.card, formStyles.confirmationCard]}>
                        <Text style={styles.cardTitle}>{saveWarning ? "Leave this save?" : "Discard unsaved changes?"}</Text>
                        <Text style={styles.message}>{saveWarning
                            ? "Stay to keep this submission and retry the exact same save. The visit may already have been saved. If you leave, reopening cannot safely retry it. Check your group's visits before adding another."
                            : "Your changes will be cleared without saving."}</Text>
                        <Pressable accessibilityRole="button" onPress={stayOnSave} style={styles.primaryButton}>
                            <Text style={styles.primaryText}>{saveWarning ? "Stay and Keep Submission" : "Stay"}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" onPress={leaveAnyway} style={styles.secondaryButton}>
                            <Text style={styles.secondaryText}>{saveWarning ? "Leave Anyway" : "Discard"}</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>}
            <Text style={styles.title}>{existingRestaurant ? "Add a Visit" : "Add Restaurant / Visit"}</Text>
            <Text style={styles.message}>Restaurant facts are shared. Your visit is private to each selected group.</Text>
            {loading && <Text style={styles.message}>Loading groups and restaurant...</Text>}
            {loadError !== "" && <Text style={styles.error}>{loadError}</Text>}
            <Text style={styles.label}>Restaurant name</Text>
            <TextInput accessibilityLabel="Restaurant name" value={name} onChangeText={value => { if (locked) return; setName(value); appleSelection.current = null; setAppleReset(v => v + 1); }} maxLength={100} editable={!locked && !existingRestaurant} placeholder="Restaurant name" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.label}>Address</Text>
            {existingRestaurant ? <TextInput accessibilityLabel="Restaurant address" value={address} maxLength={300} editable={false} placeholder="Full address, including city" placeholderTextColor="#79665E" style={styles.input} /> :
                <AddressAutocomplete {...autocomplete} value={address} selection={addressSelection} editable={!locked}
                    active={isFocused && isActive && !loading && loadError === ""}
                    resetKey={`${refreshVersion}:${foregroundVersion}`} onChange={(next, selection) => {
                        if (locked) return;
                        setAddress(next); setAddressSelection(selection); appleSelection.current = null; setAppleReset(v => v + 1);
                    }} />}
            {__DEV__ && isFocused && isActive && !loading && loadError === "" && groups.length > 0 && <ApplePlacePicker
                key={`${appleReset}:${name}:${address}`} disabled={locked} saveDestination="group visit"
                onSelect={id => { if (!locked && visible.current) appleSelection.current = id ? { id, address } : null; }} />}
            {__DEV__ && <Text style={styles.message}>An Apple ID may be saved on a new group entry. Only its owner can fill an existing entry&apos;s empty ID during a visit. Existing IDs stay unchanged.</Text>}
            <Text style={styles.label}>Cuisine (optional)</Text>
            <TextInput accessibilityLabel="Cuisine" value={cuisine} onChangeText={setCuisine} maxLength={100} editable={!locked && !existingRestaurant} placeholder="Cuisine" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.message}>{existingRestaurant ? "These shared facts stay unchanged when you add a visit." : "An exact name and address match reuses existing facts. Different locations stay separate."}</Text>
            <Text style={styles.label}>Visit date (optional)</Text>
            <TextInput accessibilityLabel="Visit date" value={visitedOn} onChangeText={setVisitedOn} maxLength={10} editable={!locked} placeholder="YYYY-MM-DD" placeholderTextColor="#79665E" autoCorrect={false} style={styles.input} />
            <Text style={styles.label}>Rating (optional, 1–5)</Text>
            <View style={formStyles.row}>
                {[1, 2, 3, 4, 5].map(value => (
                    <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Rating ${value} out of 5`} accessibilityState={{ selected: rating === value }} disabled={locked} onPress={() => setRating(rating === value ? null : value)} style={[formStyles.choice, rating === value && formStyles.selected]}>
                        <Text style={rating === value ? styles.primaryText : styles.secondaryText}>{value}</Text>
                    </Pressable>
                ))}
            </View>
            <Text style={styles.label}>Would you go again? (optional)</Text>
            <View style={formStyles.row}>
                {[true, false].map(value => (
                    <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected: wouldGoAgain === value }} disabled={locked} onPress={() => setWouldGoAgain(wouldGoAgain === value ? null : value)} style={[formStyles.choice, wouldGoAgain === value && formStyles.selected]}>
                        <Text style={wouldGoAgain === value ? styles.primaryText : styles.secondaryText}>{value ? "Yes" : "No"}</Text>
                    </Pressable>
                ))}
            </View>
            <Text style={styles.message}>Tap a selected choice again to leave it unanswered.</Text>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput accessibilityLabel="Visit notes" value={notes} onChangeText={setNotes} maxLength={4000} multiline editable={!locked} placeholder="A memory from this visit" placeholderTextColor="#79665E" style={[styles.input, formStyles.notes]} />
            <Text style={styles.label}>Save to groups</Text>
            {!loading && loadError === "" && groups.length === 0 && (
                <>
                    <Text style={styles.message}>Create or join a group from Groups before saving a visit.</Text>
                    <Pressable accessibilityRole="button" disabled={saving} onPress={() => requestLeave(() => router.dismissTo("/groups", { withAnchor: true }))} style={[styles.secondaryButton, saving && styles.disabled]}>
                        <Text style={styles.secondaryText}>Create / Join a Group</Text>
                    </Pressable>
                </>
            )}
            {groups.map(group => {
                const selected = selectedGroups.includes(group.id);
                return (
                    <Pressable key={group.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} disabled={locked || loading} onPress={() => setSelectedGroups(ids => selected ? ids.filter(id => id !== group.id) : [...ids, group.id])} style={[styles.card, selected && formStyles.selected]}>
                        <Text style={selected ? styles.primaryText : styles.cardTitle}>{selected ? "✓ " : ""}{group.name}</Text>
                    </Pressable>
                );
            })}
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {completed ? <>
                <Text style={styles.message}>Visit saved. Returning to your groups will not save it again.</Text>
                <Pressable accessibilityRole="button" onPress={finishSubmission} style={styles.primaryButton}><Text style={styles.primaryText}>Continue to Groups</Text></Pressable>
            </> : <Pressable accessibilityRole="button" disabled={saving || (!submissionLocked && (loading || loadError !== "" || groups.length === 0))} onPress={handleSave} style={[styles.primaryButton, saving && styles.disabled]}>
                <Text style={styles.primaryText}>{saving ? "Saving..." : submissionLocked ? "Retry Same Visit Save" : "Save Visit"}</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" disabled={saving || loading} onPress={() => setRefreshVersion(value => value + 1)} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Refresh Groups</Text>
            </Pressable>
        </ScrollView>
    );
}

const formStyles = StyleSheet.create({
    confirmationOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
    confirmationCard: { width: "100%", maxWidth: 480 },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    choice: { minWidth: 48, minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E85D3F", borderRadius: 12 },
    selected: { backgroundColor: "#E85D3F", borderColor: "#E85D3F" },
    notes: { minHeight: 112, textAlignVertical: "top" },
});
