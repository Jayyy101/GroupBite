import { PersonalAccess } from "@/components/personal-access";
import { PersonalPlaceFields } from "@/components/personal-place-fields";
import { useAddressSearch, type AddressSearchBinding } from "@/hooks/use-address-search";
import { createPersonalPlace, getPersonalPlace, normalizePersonalPlace, PersonalPlaceError, personalPlaceErrorMessage, reconcilePersonalPlace, updatePersonalPlace } from "@/lib/personal-places";
import { isUuid } from "@/lib/restaurant-ui";
import type { AddressSuggestion } from "@/lib/address-search";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlace, PersonalPlaceFields as Fields } from "@/types/database";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type RefObject } from "react";
import { AppState, Pressable, ScrollView, Text } from "react-native";

const empty: Fields = { name: "", address: "", cuisine: null, visited_on: null, rating: null, would_go_again: null, notes: null };

export default function PersonalPlaceFormScreen() {
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    const { session, loading } = useAuth();
    // Only creation keeps an account-scoped, in-memory draft above the gate.
    // Sign-out/account changes dispose it; the visible form still unmounts.
    if (id === undefined && !loading && session) {
        return <PersonalPlaceForm key={session.user.id} userId={session.user.id} />;
    }
    return <PersonalAccess title={id === undefined ? "Add Personal Place" : "Edit Personal Place"}>{userId => <PersonalPlaceForm key={`${userId}:${JSON.stringify(id)}`} userId={userId} id={id} />}</PersonalAccess>;
}

function PersonalPlaceForm({ userId, id }: { userId: string; id?: string | string[] }) {
    const router = useRouter();
    const autocomplete = useAddressSearch();
    const [fields, setFields] = useState<Fields>(empty);
    const [place, setPlace] = useState<PersonalPlace | null>(null);
    const [loading, setLoading] = useState(id !== undefined);
    const [loadError, setLoadError] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const mounted = useRef(false);
    const submitting = useRef(false);
    const blockedRef = useRef(false);
    const submission = useRef<{ requestId: string } | null>(null);
    const visibility = useRef({ active: false, epoch: 0 });
    useEffect(() => {
        mounted.current = true;
        let active = true;
        setFields(empty); setPlace(null); setError(""); setLoadError(""); setBlocked(false);
        blockedRef.current = false;
        // Invalidate navigation even if inactive -> active is batched by React.
        const subscription = id === undefined ? AppState.addEventListener("change", state => {
            if (state !== "active") visibility.current.epoch++;
        }) : null;
        if (id !== undefined) {
            setLoading(true);
            if (!isUuid(id)) { setLoadError("This place could not be found or is unavailable."); setLoading(false); }
            else getPersonalPlace(userId, id).then(data => {
                if (!active) return;
                if (!data) { setLoadError("This place could not be found or is unavailable."); return; }
                setPlace(data);
                setFields({ name: data.name, address: data.address, cuisine: data.cuisine, visited_on: data.visited_on, rating: data.rating, would_go_again: data.would_go_again, notes: data.notes });
            }).catch(error => { if (active) setLoadError(personalPlaceErrorMessage(error)); })
                .finally(() => { if (active) setLoading(false); });
        }
        return () => { active = false; mounted.current = false; subscription?.remove(); };
    }, [userId, id, refresh]);

    function back() {
        if (submitting.current) return;
        clearCreateDraft();
        if (router.canGoBack()) router.back();
        else if (isUuid(id)) router.replace({ pathname: "/personal-place/[id]", params: { id } });
        else router.replace("/my-places");
    }
    function open(saved: PersonalPlace) {
        router.dismissTo({ pathname: "/personal-place/[id]", params: { id: saved.id } });
    }
    function clearCreateDraft() {
        if (id !== undefined) return;
        setFields(empty); setError(""); setBlocked(false);
        blockedRef.current = false; submission.current = null;
        visibility.current.epoch++;
    }
    function confirmed(saved: PersonalPlace, epoch: number) {
        if (!mounted.current) return;
        const canOpen = visibility.current.active && visibility.current.epoch === epoch && AppState.currentState === "active";
        if (id === undefined) {
            setFields(empty);
            // Retain only the request identity until its result is reviewed.
            // An absent receipt later is never permission to replay this save.
            blockedRef.current = true; setBlocked(true);
            setError(canOpen ? "" : "This place was saved. Check the saved result or review My Places.");
        }
        if (canOpen) open(saved);
    }
    async function save() {
        if (!mounted.current || !visibility.current.active || submitting.current || busy || loading || loadError || blockedRef.current || blocked) return;
        setError("");
        let value: Fields;
        try { value = normalizePersonalPlace(fields); }
        catch (error) { setError(personalPlaceErrorMessage(error)); return; }
        submitting.current = true; setBusy(true);
        const epoch = visibility.current.epoch;
        if (id === undefined) submission.current = { requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
        try {
            const saved = place ? await updatePersonalPlace(userId, place, value)
                : await createPersonalPlace(userId, value, submission.current!.requestId);
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
    async function checkSavedResult() {
        if (!mounted.current || !visibility.current.active || submitting.current || !submission.current) return;
        submitting.current = true; setBusy(true);
        const epoch = visibility.current.epoch;
        try {
            const saved = await reconcilePersonalPlace(userId, submission.current.requestId);
            if (!mounted.current) return;
            if (saved) confirmed(saved, epoch);
            else setError("No saved result is visible yet. Review My Places before starting a new save; the original request may still finish.");
        } catch {
            if (mounted.current) setError("Could not check the saved result. Check your connection, then check again or review My Places.");
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    const form = <PersonalPlaceFormBody key={refresh} autocomplete={autocomplete} id={id} fields={fields} setFields={setFields} loading={loading} loadError={loadError}
        error={error} busy={busy} blocked={blocked} back={back} save={save} checkSavedResult={checkSavedResult}
        review={() => { if (!submitting.current) { clearCreateDraft(); router.dismissTo("/my-places"); } }}
        cancelEdit={() => { if (isUuid(id)) router.dismissTo({ pathname: "/personal-place/[id]", params: { id } }); }}
        refresh={() => setRefresh(value => value + 1)} visibility={visibility} />;
    return id === undefined ? <PersonalAccess title="Add Personal Place">{() => form}</PersonalAccess> : form;
}

function PersonalPlaceFormBody({ autocomplete, id, fields, setFields, loading, loadError, error, busy, blocked, back, save, checkSavedResult, review, cancelEdit, refresh, visibility }: {
    autocomplete: AddressSearchBinding;
    id?: string | string[];
    fields: Fields;
    setFields: (fields: Fields | ((current: Fields) => Fields)) => void;
    loading: boolean; loadError: string; error: string; busy: boolean; blocked: boolean;
    back: () => void; save: () => Promise<void>; checkSavedResult: () => Promise<void>;
    review: () => void; cancelEdit: () => void; refresh: () => void;
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
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Pressable accessibilityRole="button" disabled={busy} onPress={back} style={[styles.secondaryButton, styles.backButton, busy && styles.disabled]}><Text style={styles.secondaryText}>Back</Text></Pressable>
            <Text style={styles.title}>{id === undefined ? "Add Personal Place" : "Edit Personal Place"}</Text>
            <Text style={styles.message}>Only you can see this saved place. No group is required.</Text>
            {loading ? <Text style={styles.message}>Loading place...</Text> : loadError !== "" ? <Text style={styles.error}>{loadError}</Text> : <>
                <PersonalPlaceFields autocomplete={autocomplete} value={fields} onChange={setFields} busy={busy || blocked}
                    addressSelection={addressSelection} onAddressChange={(address, selection) => {
                        setFields(current => ({ ...current, address })); setAddressSelection(selection);
                    }} />
                {error !== "" && <Text style={styles.error}>{error}</Text>}
                <Pressable accessibilityRole="button" disabled={busy || blocked} onPress={save} style={[styles.primaryButton, (busy || blocked) && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Saving..." : id === undefined ? "Save Personal Place" : "Save Changes"}</Text></Pressable>
                {blocked && id === undefined && <>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={checkSavedResult} style={styles.secondaryButton}><Text style={styles.secondaryText}>Check Saved Result</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={review} style={styles.secondaryButton}><Text style={styles.secondaryText}>Review My Places</Text></Pressable>
                </>}
                {blocked && isUuid(id) && <Pressable accessibilityRole="button" disabled={busy} onPress={cancelEdit} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel and Refresh Place</Text></Pressable>}
            </>}
            {id !== undefined && loadError !== "" && <Pressable accessibilityRole="button" disabled={busy || loading} onPress={refresh} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refresh Place</Text></Pressable>}
        </ScrollView>
    );
}
