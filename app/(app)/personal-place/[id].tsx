import { PersonalAccess } from "@/components/personal-access";
import { deletePersonalPlace, getPersonalPlace, personalPlaceErrorMessage } from "@/lib/personal-places";
import { isUuid } from "@/lib/restaurant-ui";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlace } from "@/types/database";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

export default function PersonalPlaceScreen() {
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    return <PersonalAccess title="Personal Place">{userId => <PersonalPlaceDetails key={`${userId}:${JSON.stringify(id)}`} userId={userId} id={id} />}</PersonalAccess>;
}

function PersonalPlaceDetails({ userId, id }: { userId: string; id?: string | string[] }) {
    const router = useRouter();
    const [place, setPlace] = useState<PersonalPlace | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const mounted = useRef(false);
    const submitting = useRef(false);
    useEffect(() => {
        let active = true;
        mounted.current = true;
        setPlace(null); setLoading(true); setError(""); setConfirming(false);
        if (!isUuid(id)) { setError("This place could not be found or is unavailable."); setLoading(false); }
        else getPersonalPlace(userId, id).then(data => { if (active) setPlace(data); })
            .catch(error => { if (active) setError(personalPlaceErrorMessage(error)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; mounted.current = false; };
    }, [userId, id, refresh]);
    async function remove() {
        if (!confirming || !place || submitting.current) return;
        submitting.current = true; setBusy(true); setNotice("");
        try {
            await deletePersonalPlace(userId, place);
            if (mounted.current) router.dismissTo("/my-places");
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
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.dismissTo("/my-places")} style={[styles.secondaryButton, styles.backButton, busy && styles.disabled]}><Text style={styles.secondaryText}>Back</Text></Pressable>
            <Text style={styles.title}>{place?.name ?? "Personal Place"}</Text>
            <Text style={styles.message}>Only you can see this saved place.</Text>
            {notice !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{notice}</Text>}
            {loading ? <Text style={styles.message}>Loading place...</Text> : error !== "" ? <Text style={styles.error}>{error}</Text> : !place ? <Text style={styles.message}>This place could not be found or is unavailable.</Text> : <>
                <Text style={styles.message}>{place.address}</Text>
                {place.cuisine !== null && <Text style={styles.message}>Cuisine: {place.cuisine}</Text>}
                {place.visited_on !== null && <Text style={styles.message}>Date: {place.visited_on}</Text>}
                {place.rating !== null && <Text style={styles.message}>Rating: {place.rating}/5</Text>}
                {place.would_go_again !== null && <Text style={styles.message}>Would go again: {place.would_go_again ? "Yes" : "No"}</Text>}
                {place.notes !== null && <Text style={styles.message}>{place.notes}</Text>}
                {!confirming ? <>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: "/personal-place-form", params: { id: place.id } })} style={styles.primaryButton}><Text style={styles.primaryText}>Edit Personal Place</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirming(true)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Delete Personal Place</Text></Pressable>
                </> : <View>
                    <Text style={styles.message}>Permanently delete this personal saved place? This cannot be undone. Group Visits and device-local Places are unaffected.</Text>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirming(false)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={remove} style={[styles.primaryButton, busy && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Deleting..." : "Confirm Delete"}</Text></Pressable>
                </View>}
            </>}
            <Pressable accessibilityRole="button" disabled={busy || loading || confirming} onPress={() => { setNotice(""); setRefresh(value => value + 1); }} style={[styles.secondaryButton, (busy || loading || confirming) && styles.disabled]}><Text style={styles.secondaryText}>Refresh Place</Text></Pressable>
        </ScrollView>
    );
}
