import { PersonalAccess } from "@/components/personal-access";
import { PersonalPlaceFields } from "@/components/personal-place-fields";
import { createPersonalPlace, getPersonalPlace, normalizePersonalPlace, PersonalPlaceError, personalPlaceErrorMessage, reconcilePersonalPlace, updatePersonalPlace } from "@/lib/personal-places";
import { isUuid } from "@/lib/restaurant-ui";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlace, PersonalPlaceFields as Fields } from "@/types/database";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";

const empty: Fields = { name: "", address: "", cuisine: null, visited_on: null, rating: null, would_go_again: null, notes: null };

export default function PersonalPlaceFormScreen() {
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    return <PersonalAccess title={id === undefined ? "Add Personal Place" : "Edit Personal Place"}>{userId => <PersonalPlaceForm key={`${userId}:${JSON.stringify(id)}`} userId={userId} id={id} />}</PersonalAccess>;
}

function PersonalPlaceForm({ userId, id }: { userId: string; id?: string | string[] }) {
    const router = useRouter();
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
    const submission = useRef<{ requestId: string } | null>(null);
    useEffect(() => {
        mounted.current = true;
        let active = true;
        setFields(empty); setPlace(null); setError(""); setLoadError(""); setBlocked(false);
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
        return () => { active = false; mounted.current = false; };
    }, [userId, id, refresh]);

    function back() {
        if (router.canGoBack()) router.back();
        else if (isUuid(id)) router.replace({ pathname: "/personal-place/[id]", params: { id } });
        else router.replace("/my-places");
    }
    function open(saved: PersonalPlace) {
        router.dismissTo({ pathname: "/personal-place/[id]", params: { id: saved.id } });
    }
    async function save() {
        if (submitting.current || busy || loading || loadError || blocked) return;
        setError("");
        let value: Fields;
        try { value = normalizePersonalPlace(fields); }
        catch (error) { setError(personalPlaceErrorMessage(error)); return; }
        submitting.current = true; setBusy(true);
        if (id === undefined) submission.current = { requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
        try {
            const saved = place ? await updatePersonalPlace(userId, place, value)
                : await createPersonalPlace(userId, value, submission.current!.requestId);
            if (mounted.current) open(saved);
        } catch (error) {
            if (mounted.current) {
                setError(error instanceof PersonalPlaceError ? error.message : "Could not confirm this save. Review the saved result before starting another save.");
                // Never replay a possibly committed mutation. Reconciliation is read-only.
                setBlocked(!(error instanceof PersonalPlaceError && error.kind === "invalid"));
            }
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    async function checkSavedResult() {
        if (submitting.current || !submission.current) return;
        submitting.current = true; setBusy(true);
        try {
            const saved = await reconcilePersonalPlace(userId, submission.current.requestId);
            if (!mounted.current) return;
            if (saved) open(saved);
            else setError("No saved result is visible yet. Review My Places before starting a new save; the original request may still finish.");
        } catch {
            if (mounted.current) setError("Could not check the saved result. Check your connection, then check again or review My Places.");
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable accessibilityRole="button" disabled={busy} onPress={back} style={[styles.secondaryButton, styles.backButton, busy && styles.disabled]}><Text style={styles.secondaryText}>Back</Text></Pressable>
            <Text style={styles.title}>{id === undefined ? "Add Personal Place" : "Edit Personal Place"}</Text>
            <Text style={styles.message}>Only you can see this saved place. No group is required.</Text>
            {loading ? <Text style={styles.message}>Loading place...</Text> : loadError !== "" ? <Text style={styles.error}>{loadError}</Text> : <>
                <PersonalPlaceFields value={fields} onChange={setFields} busy={busy || blocked} />
                {error !== "" && <Text style={styles.error}>{error}</Text>}
                <Pressable accessibilityRole="button" disabled={busy || blocked} onPress={save} style={[styles.primaryButton, (busy || blocked) && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Saving..." : id === undefined ? "Save Personal Place" : "Save Changes"}</Text></Pressable>
                {blocked && id === undefined && <>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={checkSavedResult} style={styles.secondaryButton}><Text style={styles.secondaryText}>Check Saved Result</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.dismissTo("/my-places")} style={styles.secondaryButton}><Text style={styles.secondaryText}>Review My Places</Text></Pressable>
                </>}
                {blocked && isUuid(id) && <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.dismissTo({ pathname: "/personal-place/[id]", params: { id } })} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel and Refresh Place</Text></Pressable>}
            </>}
            {id !== undefined && loadError !== "" && <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => setRefresh(value => value + 1)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refresh Place</Text></Pressable>}
        </ScrollView>
    );
}
