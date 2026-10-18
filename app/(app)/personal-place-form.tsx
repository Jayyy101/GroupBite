import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useIsFocused } from "@react-navigation/native";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { PersonalAccess } from "@/components/personal-access";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { PersonalPlaceFields } from "@/components/personal-place-fields";
import { useAddressSearch, type AddressSearchBinding } from "@/hooks/use-address-search";
import { getPersonalPlace, normalizePersonalPlace, PersonalPlaceError, personalPlaceErrorMessage, updatePersonalPlace } from "@/lib/personal-places";
import { isUuid } from "@/lib/restaurant-ui";
import { personalPlaceHref } from "@/lib/restaurant-navigation";
import type { AddressSuggestion } from "@/lib/address-search";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlace, PersonalPlaceFields as Fields } from "@/types/database";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type RefObject } from "react";
import { AppState, Pressable, Text } from "react-native";

const empty: Fields = { name: "", address: "", cuisine: null, visited_on: null, rating: null, would_go_again: null, notes: null };
export default function PersonalPlaceFormScreen() {
    const { id, fromAdd } = useLocalSearchParams<{ id: string | string[]; fromAdd?: string }>();
    const { session, loading } = useAuth();
    if (id === undefined) return <Redirect href="/add" />;
    // Account/record-scoped state survives temporary hiding; private UI does not.
    if (!loading && session) {
        return <PersonalPlaceForm key={`${session.user.id}:${JSON.stringify(id)}`} userId={session.user.id} id={id} fromAdd={fromAdd === "1"} />;
    }
    return <PersonalAccess title="Edit Personal Place">{userId => <PersonalPlaceForm key={`${userId}:${JSON.stringify(id)}`} userId={userId} id={id} fromAdd={fromAdd === "1"} />}</PersonalAccess>;
}

function PersonalPlaceForm({ userId, id, fromAdd }: { userId: string; id: string | string[]; fromAdd: boolean }) {
    const router = useRouter();
    const autocomplete = useAddressSearch();
    const baseline = useRef<Fields>(empty);
    const completed = useRef(false);
    const [fields, setFields] = useState<Fields>(empty);
    const [place, setPlace] = useState<PersonalPlace | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const focused = useIsFocused();
    const { isActive, version: foregroundVersion } = useForegroundRefresh();
    const [editVerified, setEditVerified] = useState(false);
    const verified = useRef(false);
    const loadedPlace = useRef<PersonalPlace | null>(null);
    const mounted = useRef(false);
    const submitting = useRef(false);
    const blockedRef = useRef(false);
    const visibility = useRef({ active: false, epoch: 0 });
    const leave = useLeaveGuard({ userId, dirty: JSON.stringify(fields) !== JSON.stringify(baseline.current),
        busy, uncertain: blocked, onDiscard: () => { completed.current = true; } });
    useEffect(() => {
        mounted.current = true;
        // Also covers batched inactive -> active transitions before React renders.
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") {
                visibility.current.epoch++;
                verified.current = false;
            }
        });
        return () => { mounted.current = false; subscription.remove(); };
    }, [id]);

    useEffect(() => {
        verified.current = false; setEditVerified(false);
        setLoading(true); setLoadError("");
        if (!focused || !isActive) return;
        let active = true;
        if (!isUuid(id)) {
            setLoadError("This place could not be found or is unavailable."); setLoading(false);
            return;
        }
        const readEpoch = visibility.current.epoch;
        getPersonalPlace(userId, id).then(data => {
            if (!active || visibility.current.epoch !== readEpoch || AppState.currentState !== "active") return;
            if (!data) { setLoadError("This place could not be found or is unavailable."); return; }
            if (!loadedPlace.current) {
                loadedPlace.current = data; setPlace(data);
                const loaded = { name: data.name, address: data.address, cuisine: data.cuisine, visited_on: data.visited_on, rating: data.rating, would_go_again: data.would_go_again, notes: data.notes };
                baseline.current = loaded; setFields(loaded);
            } else if (loadedPlace.current.revision !== data.revision) {
                // Preserve the draft and original optimistic revision; never silently
                // rebase old edits onto a newer saved memory.
                blockedRef.current = true; setBlocked(true);
                setError("This place changed while you were away. Your draft is retained. Cancel and refresh before editing again.");
            }
            verified.current = true; setEditVerified(true);
        }).catch(error => { if (active) setLoadError(personalPlaceErrorMessage(error)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [userId, id, refresh, focused, isActive, foregroundVersion]);

    function back() {
        if (submitting.current) return;
        leave.requestLeave(() => {
            if (router.canGoBack()) router.back();
            else if (isUuid(id)) router.replace(personalPlaceHref(id, fromAdd));
            else router.replace("/my-places");
        });
    }
    function open(saved: PersonalPlace) {
        completed.current = true;
        leave.finish(() => router.dismissTo(personalPlaceHref(saved.id, fromAdd), { withAnchor: true }));
    }
    function confirmed(saved: PersonalPlace, epoch: number) {
        if (!mounted.current) return;
        const canOpen = visibility.current.active && visibility.current.epoch === epoch && AppState.currentState === "active" && verified.current;
        if (!canOpen) {
            blockedRef.current = true; setBlocked(true);
            setError("This place was saved. Cancel and refresh the place to review it; this form will not save again.");
        }
        if (canOpen) open(saved);
    }
    async function save() {
        if (!mounted.current || completed.current || !visibility.current.active || !verified.current || AppState.currentState !== "active" || submitting.current || busy || loading || loadError || blockedRef.current || blocked || !place) return;
        setError("");
        let value: Fields;
        try { value = normalizePersonalPlace(fields); }
        catch (error) { setError(personalPlaceErrorMessage(error)); return; }
        submitting.current = true; setBusy(true);
        const epoch = visibility.current.epoch;
        try {
            const saved = await updatePersonalPlace(userId, place, value, () => mounted.current && visibility.current.active && verified.current
                    && visibility.current.epoch === epoch && AppState.currentState === "active");
            confirmed(saved, epoch);
        } catch (error) {
            if (mounted.current) {
                setError(error instanceof PersonalPlaceError ? error.message : "Could not confirm this save. Review the saved result before starting another save.");
                // Never replay a possibly committed mutation. Reconciliation is read-only.
                blockedRef.current = !(error instanceof PersonalPlaceError && error.kind === "invalid");
                setBlocked(blockedRef.current);
            }
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    const form = <PersonalPlaceFormBody key={refresh} autocomplete={autocomplete} id={id} fields={fields} setFields={setFields} loading={loading || ((!editVerified || !verified.current) && !loadError)} loadError={loadError}
        error={error} busy={busy} blocked={blocked} back={back} save={save}
        cancelEdit={() => { if (isUuid(id)) leave.requestLeave(() => router.dismissTo(personalPlaceHref(id, fromAdd), { withAnchor: true })); }}
        refresh={() => setRefresh(value => value + 1)} visibility={visibility} />;
    const guardedForm = <>{leave.confirmation}{form}</>;
    return <PersonalAccess title="Edit Personal Place">{() => guardedForm}</PersonalAccess>;
}

function PersonalPlaceFormBody({ autocomplete, id, fields, setFields, loading, loadError, error, busy, blocked, back, save, cancelEdit, refresh, visibility }: {
    autocomplete: AddressSearchBinding;
    id: string | string[];
    fields: Fields;
    setFields: (fields: Fields | ((current: Fields) => Fields)) => void;
    loading: boolean; loadError: string; error: string; busy: boolean; blocked: boolean;
    back: () => void; save: () => Promise<void>;
    cancelEdit: () => void; refresh: () => void;
    visibility: RefObject<{ active: boolean; epoch: number }>;
}) {
    // Selection/coordinates and search work belong to the disposable UI only.
    const [addressSelection, setAddressSelection] = useState<AddressSuggestion | null>(null);
    useEffect(() => {
        const state = visibility.current;
        state.active = true;
        return () => { state.active = false; state.epoch++; };
    }, [visibility]);
    return (
        <ScreenScaffold edgeToEdge includeBottomInset title="Edit Personal Place" busy={busy} onBack={back}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
            <Text style={styles.message}>Only you can see this saved place. No group is required.</Text>
            {loading ? <Text style={styles.message}>Loading place...</Text> : loadError !== "" ? <Text style={styles.error}>{loadError}</Text> : <>
                <PersonalPlaceFields autocomplete={autocomplete} value={fields} onChange={setFields} busy={busy || blocked}
                    addressSelection={addressSelection} onAddressChange={(address, selection) => {
                        setFields(current => ({ ...current, address })); setAddressSelection(selection);
                    }} />
                {error !== "" && <Text style={styles.error}>{error}</Text>}
                <Pressable accessibilityRole="button" disabled={busy || blocked} onPress={save} style={[styles.primaryButton, (busy || blocked) && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Saving..." : "Save Changes"}</Text></Pressable>
                {blocked && isUuid(id) && <Pressable accessibilityRole="button" disabled={busy} onPress={cancelEdit} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel and Refresh Place</Text></Pressable>}
            </>}
            {loadError !== "" && <Pressable accessibilityRole="button" disabled={busy || loading} onPress={refresh} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refresh Place</Text></Pressable>}
        </ScreenScaffold>
    );
}
