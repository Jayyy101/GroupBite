import { AddResults } from "@/components/add-results";
import { PersonalAccess } from "@/components/personal-access";
import { ScreenScaffold } from "@/components/screen-scaffold";
import Ionicons from "@expo/vector-icons/Ionicons";
import { VisitFields } from "@/components/visit-fields";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { accountAccessToken } from "@/lib/account-session";
import { getPersonalPlace } from "@/lib/personal-places";
import { withRequestDeadline } from "@/lib/request-deadline";
import { isUuid } from "@/lib/restaurant-ui";
import { detailOrigin, destinationHref, savedDestinationHref } from "@/lib/restaurant-navigation";
import { isConfirmedAdd } from "@/lib/unified-add";
import { supabase } from "@/lib/supabase";
import type { AddFields, Destination } from "@/lib/unified-add";
import { useAuth } from "@/providers/auth";
import { useUnifiedAdd } from "@/providers/unified-add";
import { backendStyles as styles } from "@/styles/backend";
import type { AddRestaurant, Group } from "@/types/database";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, TextInput } from "react-native";

export function localToday(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}
export default function UnifiedAddFormScreen() {
    const { session } = useAuth();
    const params = useLocalSearchParams<{ groupId?: string; restaurantId?: string; personalId?: string; fromHome?: string; fromMap?: string; fromAdd?: string }>();
    return session ? <UnifiedAddForm key={`${session.user.id}:${JSON.stringify(params)}`} userId={session.user.id} params={params} />
        : <PersonalAccess title="Add">{() => null}</PersonalAccess>;
}
function UnifiedAddForm({ userId, params }: { userId: string; params: { groupId?: string; restaurantId?: string; personalId?: string; fromHome?: string; fromMap?: string; fromAdd?: string } }) {
    const router = useRouter(), { coordinator, state } = useUnifiedAdd(), { session, loading: authLoading } = useAuth();
    const focused = useIsFocused(), { isActive, version } = useForegroundRefresh();
    const [initial] = useState<AddFields>(() => ({ restaurant: state.restaurant ?? { name: "", address: "", cuisine: null },
        visited_on: localToday(), rating: null, would_go_again: null, privateNotes: "", groupNotes: "" }));
    const [fields, setFields] = useState(initial), [destinations, setDestinations] = useState<Destination[]>([]);
    const [groups, setGroups] = useState<(Group & { membershipId: string })[]>([]);
    const [verified, setVerified] = useState(false);
    const [loading, setLoading] = useState(true), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
    const alive = useRef(false), visible = useRef(false), epoch = useRef(0), verifiedEpoch = useRef(-1), abandoned = useRef(false), departed = useRef(false);
    const sourceLoaded = useRef(false), baseline = useRef(initial);
    visible.current = focused && isActive && !authLoading && session?.user.id === userId;
    const canOperate = () => alive.current && !abandoned.current && !departed.current && visible.current && AppState.currentState === "active";
    const canSave = () => canOperate() && verifiedEpoch.current === epoch.current;
    const leave = useLeaveGuard({ userId, dirty: JSON.stringify(fields) !== JSON.stringify(baseline.current) || destinations.length > 0,
        busy: state.busy, uncertain: state.attempts.some(a => a.status !== "saved") || !!state.error,
        uncertainExitMessage: "Some destinations may already have saved. Leaving does not undo them. Recovery remains available in Add. Review saved results before starting another visit.",
        onDiscard: () => { abandoned.current = true; if (!state.attempts.length) coordinator.selectRestaurant(null); } });
    useEffect(() => {
        alive.current = true;
        const subscription = AppState.addEventListener("change", s => { if (s !== "active") { epoch.current++; verifiedEpoch.current = -1; } });
        return () => { alive.current = false; subscription.remove(); };
    }, []);
    useEffect(() => {
        verifiedEpoch.current = -1; setVerified(false); setLoading(true); setGroups([]);
        if (!focused || !isActive) { epoch.current++; return; }
        let valid = true; const readEpoch = epoch.current;
        void (async () => {
            try {
                const token = await accountAccessToken(userId);
                if (!valid || !canOperate()) return;
                const [g, m] = await Promise.all([
                    withRequestDeadline(signal => supabase.from("groups").select("*").order("name").setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)),
                    withRequestDeadline(signal => supabase.from("group_memberships").select("group_id,membership_id").eq("user_id", userId)
                        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)),
                ]);
                if (g.error || m.error) throw new Error("Could not verify destinations.");
                let source: AddRestaurant | null = null;
                const personalId = params.personalId ?? (initial.restaurant.destination_kind === "personal" ? initial.restaurant.entry_id : undefined);
                const sourceGroupId = params.groupId ?? initial.restaurant.group_id;
                const sourceEntryId = initial.restaurant.destination_kind === "group" ? initial.restaurant.entry_id : undefined;
                if (personalId !== undefined) {
                    if (!isUuid(personalId)) throw new Error("Invalid saved restaurant.");
                    const place = await getPersonalPlace(userId, personalId);
                    if (!place) throw new Error("Saved restaurant unavailable.");
                    source = { name: place.name, address: place.address, cuisine: place.cuisine, apple_place_id: place.apple_place_id,
                        destination_kind: "personal", entry_id: place.id, group_id: null };
                } else if (params.restaurantId !== undefined || sourceEntryId !== undefined) {
                    if (!isUuid(sourceGroupId) || (params.restaurantId !== undefined ? !isUuid(params.restaurantId) : !isUuid(sourceEntryId))) throw new Error("Invalid saved restaurant.");
                    const query = supabase.from("group_restaurants").select("*").eq("group_id",sourceGroupId);
                    const scoped = params.restaurantId !== undefined ? query.eq("restaurant_id",params.restaurantId) : query.eq("id",sourceEntryId!);
                    const result = await withRequestDeadline(signal => scoped.setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false).single());
                    if (result.error) throw result.error;
                    const facts = await withRequestDeadline(signal => supabase.from("restaurants").select("*").eq("id",result.data.restaurant_id)
                        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false).single());
                    if (facts.error) throw facts.error;
                    source = { name: facts.data.name, address: facts.data.address, cuisine: facts.data.cuisine,
                        apple_place_id: result.data.apple_place_id, destination_kind: "group", group_id: sourceGroupId, entry_id: result.data.id };
                }
                if (__DEV__ && source?.entry_id && source.destination_kind) {
                    const locationArgs = { target_kind: source.destination_kind, target_entry_id: source.entry_id, expected_address: source.address };
                    const location = await withRequestDeadline(signal => supabase.rpc("get_saved_mapkit_location", locationArgs)
                        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
                    if (location.error) throw location.error;
                    if (location.data) source = { ...source, mapkit_point: location.data };
                }
                const selectedSource = source ?? initial.restaurant;
                if (selectedSource.destination_kind === "group" && !m.data.some(row => row.group_id === selectedSource.group_id)) {
                    throw new Error("Source membership is no longer available.");
                }
                if (sourceLoaded.current && source && (source.name !== baseline.current.restaurant.name || source.address !== baseline.current.restaurant.address)) {
                    throw new Error("Saved restaurant changed. Select it again.");
                }
                if (!valid || !canOperate() || readEpoch !== epoch.current) return;
                const allowed = g.data.flatMap(group => {
                    const membership = m.data.find(row => row.group_id === group.id);
                    return membership ? [{ ...group, membershipId: membership.membership_id }] : [];
                });
                setGroups(allowed);
                setDestinations(selected => selected.filter(d => d.kind === "personal" || allowed.some(group => group.id === d.groupId && group.membershipId === d.membershipId)));
                if (source && !sourceLoaded.current) { const next = { ...initial, restaurant: source }; baseline.current = next; setFields(next); }
                sourceLoaded.current = true; verifiedEpoch.current = readEpoch; setVerified(true); setError("");
            } catch { if (valid) setError("Could not verify destinations or the saved restaurant. Refresh to try again."); }
            finally { if (valid) setLoading(false); }
        })();
        return () => { valid = false; verifiedEpoch.current = -1; };
        // Initial source and draft are deliberately not rebased by refreshes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, focused, isActive, version, refresh, params.personalId, params.restaurantId, params.groupId]);
    async function save() {
        if (!canSave() || loading || coordinator.state.busy || coordinator.state.attempts.length || !coordinator.state.ready || coordinator.state.error) return;
        const saveEpoch = epoch.current;
        try {
            await coordinator.start(fields,destinations,() => canSave() && epoch.current === saveEpoch);
            if (!canOperate() || epoch.current !== saveEpoch) return;
            const results = coordinator.state.attempts;
            if (results.length === 1 && results[0].status === "saved" && results[0].result?.available) {
                const result = results[0].result;
                departed.current = true;
                leave.finish(() => { router.dismissTo(savedDestinationHref(result, fields.restaurant, detailOrigin(params)), { withAnchor: true }); void coordinator.clearConfirmed(); });
            } else if (results.length) { departed.current = true; leave.finish(() => router.dismissTo("/add", { withAnchor: true })); }
        } catch (error) { if (canOperate()) setError(error instanceof Error ? error.message : "Check your restaurant and visit details."); }
    }
    const factsLocked = !!fields.restaurant.entry_id;
    function changeFact(key: "name" | "address" | "cuisine", value: string) {
        if (!canOperate() || state.busy || state.attempts.length || factsLocked) return;
        setFields(f => ({ ...f, restaurant: { ...f.restaurant, [key]: value,
            ...(key === "cuisine" ? {} : { apple_place_id: null, mapkit_point: undefined }) } }));
    }
    function toggle(destination: Destination) {
        if (!canSave() || loading || state.busy || state.attempts.length) return;
        setDestinations(all => all.some(d => d.kind === destination.kind && d.groupId === destination.groupId)
            ? all.filter(d => !(d.kind === destination.kind && d.groupId === destination.groupId)) : [...all,destination]);
    }
    return <>{leave.confirmation}<PersonalAccess title="Add a visit">{() => <ScreenScaffold edgeToEdge includeBottomInset
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets busy={state.busy}
        onBack={() => { if (canOperate() && !coordinator.state.busy) leave.requestLeave(() => router.canGoBack() ? router.back() : router.replace("/add")); }}>
        {state.attempts.length || state.error ? <AddResults canOperate={canOperate}
            separate={async (expected, temporary) => {
                const result = await coordinator.startSeparate(expected, canOperate, temporary);
                if (result === "started" && canOperate()) {
                    departed.current = true;
                    leave.finish(() => router.dismissTo("/add", { withAnchor: true }));
                }
                return result;
            }}
            open={result => leave.finish(() => {
                departed.current = true;
                router.dismissTo(destinationHref(result, "add"), { withAnchor: true });
            })}
            done={async () => {
                if (isConfirmedAdd(coordinator.state)) {
                    if (await coordinator.clearConfirmed() && canOperate()) leave.finish(() => { departed.current = true; router.dismissTo("/add", { withAnchor: true }); });
                } else leave.requestLeave(() => { departed.current = true; router.dismissTo("/add", { withAnchor: true }); });
            }} /> : loading || !verified ? <>
            <Text style={styles.message}>{loading ? "Verifying destinations..." : error}</Text>
            <Pressable accessibilityRole="button" disabled={loading} style={styles.secondaryButton} onPress={() => { if (canOperate() && !state.busy) setRefresh(v => v+1); }}><Text style={styles.secondaryText}>Refresh Destinations</Text></Pressable>
        </> : <>
            <Text style={styles.title}>Add a visit</Text>
            <Text style={styles.label}>Restaurant</Text>
            {(["name", "address", "cuisine"] as const).map(key => <TextInput key={key} accessibilityLabel={key === "name" ? "Restaurant name" : key === "address" ? "Restaurant address" : "Cuisine"}
                value={fields.restaurant[key] ?? ""} editable={!factsLocked && !state.busy && !loading} style={styles.input}
                placeholder={key === "name" ? "Restaurant name" : key === "address" ? "Full address, including city" : "Cuisine (optional)"}
                maxLength={key === "address" ? 300 : 100} onChangeText={value => changeFact(key,value)} />)}
            {factsLocked && <Text style={styles.message}>Saved restaurant facts stay unchanged when adding a visit.</Text>}
            <Text style={styles.label}>Choose destinations</Text>
            <Text style={styles.message}>All destinations start unchecked. Choose at least one.</Text>
            {[{ kind: "personal" as const, label: "My Places", groupId: undefined, membershipId: undefined },
                ...groups.map(group => ({ kind: "group" as const, groupId: group.id, membershipId: group.membershipId, label: group.name }))].map(d => {
                const selected = destinations.some(s => s.kind === d.kind && s.groupId === d.groupId);
                return <Pressable key={d.groupId ?? "personal"} accessibilityRole="checkbox" accessibilityLabel={d.label}
                    accessibilityState={{ checked: selected, disabled: loading || state.busy }}
                    disabled={loading || state.busy} onPress={() => toggle(d)}
                    style={[styles.card, styles.destinationCard, selected && styles.destinationSelected, (loading || state.busy) && styles.disabled]}>
                    <Text style={[styles.cardTitle, styles.cardHeadingText]}>{d.label}</Text>
                    <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={28} color={selected ? "#C9472C" : "#79665E"}
                        accessible={false} importantForAccessibility="no" />
                </Pressable>;
            })}
            {loading && <Text style={styles.message}>Verifying destinations...</Text>}
            <VisitFields value={{ ...fields, notes: fields.privateNotes }} disabled={loading || state.busy}
                onChange={value => { if (canSave() && !state.busy) setFields(f => ({ ...f, visited_on: value.visited_on, rating: value.rating, would_go_again: value.would_go_again, privateNotes: value.notes ?? "" })); }} />
            <Text style={styles.message}>Private notes are saved only to My Places.</Text>
            <Text style={styles.label}>Group notes (optional)</Text>
            <TextInput accessibilityLabel="Group notes" value={fields.groupNotes} editable={!loading && !state.busy} maxLength={4000} multiline
                style={[styles.input, { minHeight: 100 }]} onChangeText={groupNotes => { if (canSave() && !state.busy) setFields(f => ({ ...f,groupNotes })); }} />
            <Text style={styles.message}>Group notes are copied to each selected group. Date, rating, and would-go-again are copied to every destination.</Text>
            {error !== "" && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <Pressable accessibilityRole="button" disabled={loading || state.busy || !state.ready || !destinations.length} onPress={save} style={styles.primaryButton}>
                <Text style={styles.primaryText}>Save Visit</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={state.busy || loading} onPress={() => { if (canOperate() && !state.busy) setRefresh(v => v+1); }} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Refresh Destinations</Text></Pressable>
        </>}
    </ScreenScaffold>}</PersonalAccess></>;
}
