import { backToContext, detailFallback, detailOriginParams, type DetailOrigin } from "@/lib/restaurant-navigation";
import { PersonalAccess } from "@/components/personal-access";
import { ScreenScaffold } from "@/components/screen-scaffold";
import PersonalApplePlaceLookup from "@/components/personal-apple-place-lookup";
import DevPersonalLocationRepair from "@/components/dev-personal-location-repair";
import { deletePersonalPlace, getPersonalPlace, personalPlaceErrorMessage } from "@/lib/personal-places";
import { listPersonalVisits } from "@/lib/personal-visits";
import { isUuid } from "@/lib/restaurant-ui";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlace, PersonalVisit } from "@/types/database";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function PersonalPlaceScreen({ origin = "collection" }: { origin?: DetailOrigin }) {
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    return <PersonalAccess title="Personal Place">{userId => <PersonalPlaceDetails key={`${userId}:${JSON.stringify(id)}`} userId={userId} id={id} origin={origin} />}</PersonalAccess>;
}

function PersonalPlaceDetails({ userId, id, origin }: { userId: string; id?: string | string[]; origin: DetailOrigin }) {
    const router = useRouter();
    const back = () => backToContext(router, detailFallback(origin));
    const [place, setPlace] = useState<PersonalPlace | null>(null);
    const [visits, setVisits] = useState<PersonalVisit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [repairLocked, setRepairLocked] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const mounted = useRef(false);
    const submitting = useRef(false);
    const confirmation = useRef<PersonalPlace | null>(null);
    useEffect(() => {
        let active = true;
        mounted.current = true;
        confirmation.current = null;
        setPlace(null); setVisits([]); setLoading(true); setError(""); setConfirming(false);
        if (!isUuid(id)) { setError("This place could not be found or is unavailable."); setLoading(false); }
        else getPersonalPlace(userId, id).then(async data => {
            const history = data ? await listPersonalVisits(userId, id) : [];
            if (active) { setPlace(data); setVisits(history); }
        })
            .catch(error => { if (active) setError(personalPlaceErrorMessage(error)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; mounted.current = false; confirmation.current = null; };
    }, [userId, id, refresh]);
    async function remove() {
        if (!mounted.current || !confirming || !place || confirmation.current !== place || submitting.current) return;
        confirmation.current = null;
        submitting.current = true; setBusy(true); setNotice("");
        try {
            await deletePersonalPlace(userId, place);
            if (mounted.current) back();
        } catch (error) {
            if (mounted.current) {
                setNotice(personalPlaceErrorMessage(error));
                setPlace(null); setConfirming(false); setRefresh(value => value + 1);
            }
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    return (
        <ScreenScaffold edgeToEdge title={place?.name ?? "Personal Place"} busy={busy} onBack={back}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
            <Text style={styles.contextLabel}>My Places · Private</Text>
            <Text style={styles.message}>Only you can see this saved place.</Text>
            {notice !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{notice}</Text>}
            {loading ? <Text style={styles.message}>Loading place...</Text> : error !== "" ? <Text style={styles.error}>{error}</Text> : !place ? <Text style={styles.message}>This place could not be found or is unavailable.</Text> : <>
                <Text style={styles.message}>{place.address}</Text>
                {place.cuisine !== null && <Text style={styles.message}>Cuisine: {place.cuisine}</Text>}
                <Pressable accessibilityRole="button" disabled={busy || confirming || repairLocked} style={styles.primaryButton}
                    onPress={() => { if (mounted.current && !submitting.current) router.push({ pathname: "/add-visit", params: { personalId: place.id, ...detailOriginParams(origin) } }); }}><Text style={styles.primaryText}>Add Another Visit</Text></Pressable>
                <Text style={styles.cardTitle}>Personal visit history ({visits.length})</Text>
                {!visits.length && <Text style={styles.message}>No recorded personal visits yet.</Text>}
                {visits.map(visit => <View key={visit.id} style={styles.card}>
                    {visit.origin === "legacy" && <Text style={styles.message}>Imported saved memory</Text>}
                    <Text style={styles.cardTitle}>{visit.visited_on ?? "Date not recorded"}</Text>
                    {visit.rating !== null && <Text style={styles.message}>Rating: {visit.rating}/5</Text>}
                    {visit.would_go_again !== null && <Text style={styles.message}>Would go again: {visit.would_go_again ? "Yes" : "No"}</Text>}
                    {visit.notes !== null && <Text style={styles.message}>{visit.notes}</Text>}
                    {(["edit","delete"] as const).map(action => <Pressable key={action} accessibilityRole="button" disabled={busy || confirming || repairLocked}
                        accessibilityLabel={`${action === "edit" ? "Edit" : "Delete"} personal visit ${visit.visited_on ?? "without date"}`}
                        style={styles.secondaryButton} onPress={() => { if (mounted.current && !submitting.current) router.push({ pathname: "/personal-visit-form", params: { id: place.id, visitId: visit.id, action, ...detailOriginParams(origin) } }); }}>
                        <Text style={styles.secondaryText}>{action === "edit" ? "Edit Visit" : "Delete Visit"}</Text></Pressable>)}
                </View>)}
                {__DEV__ && <PersonalApplePlaceLookup key={`${place.id}:${place.revision}:${refresh}`} applePlaceId={place.apple_place_id} disabled={busy || confirming} />}
                {__DEV__ && <DevPersonalLocationRepair key={`repair:${place.id}:${place.revision}:${refresh}`} userId={userId} place={place}
                    disabled={busy || confirming} onLockChange={setRepairLocked} />}
                {!confirming ? <>
                    <Pressable accessibilityRole="button" disabled={busy || repairLocked} onPress={() => router.push({ pathname: "/personal-place-form", params: { id: place.id, ...detailOriginParams(origin) } })} style={styles.primaryButton}><Text style={styles.primaryText}>Edit Personal Place</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy || repairLocked} onPress={() => { if (mounted.current && !submitting.current) { confirmation.current = place; setConfirming(true); } }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Delete Personal Place</Text></Pressable>
                </> : <View>
                    <Text style={styles.message}>Permanently delete this personal saved place and all its visit history? This cannot be undone. Group Visits and device-local Places are unaffected.</Text>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { confirmation.current = null; setConfirming(false); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={remove} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Deleting..." : "Confirm Delete"}</Text></Pressable>
                </View>}
            </>}
            <Pressable accessibilityRole="button" disabled={busy || loading || confirming || repairLocked} onPress={() => { setNotice(""); setRefresh(value => value + 1); }} style={[styles.secondaryButton, (busy || loading || confirming || repairLocked) && styles.disabled]}><Text style={styles.secondaryText}>Refresh Place</Text></Pressable>
        </ScreenScaffold>
    );
}
