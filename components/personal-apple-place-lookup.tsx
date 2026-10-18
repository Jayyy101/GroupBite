import DevMapKitPreview from "@/components/dev-mapkit-preview";
import { applePlaceIdLookupAvailable, appleSearchAvailable, appleSearchErrorMessage,
    lookupApplePlace, type AppleSearchLocation } from "@/lib/apple-map-search";
import { backendStyles as styles } from "@/styles/backend";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";

// Mounted only after the authorized detail read succeeds. Apple results never
// enter saved fields, navigation, storage or database mutation helpers.
export default function PersonalApplePlaceLookup({ applePlaceId, disabled, readSavedId }: {
    applePlaceId?: string | null; disabled: boolean;
    // Group lookups reauthorize BOTH route identities before and after Apple.
    readSavedId?: (signal: AbortSignal) => Promise<string | null>;
}) {
    const focused = useIsFocused();
    const [available] = useState(appleSearchAvailable), [supported] = useState(applePlaceIdLookupAvailable);
    const [selection, setSelection] = useState<AppleSearchLocation | null>(null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
    const active = useRef(false), pending = useRef<AbortController | null>(null);
    const current = useRef({ applePlaceId, disabled, focused, readSavedId }); current.current = { applePlaceId, disabled, focused, readSavedId };
    useEffect(() => {
        active.current = focused && AppState.currentState === "active";
        setSelection(null); setMessage(""); setBusy(false);
        const subscription = AppState.addEventListener("change", state => {
            active.current = focused && state === "active";
            if (state === "active") return;
            // Also discard results for batched inactive -> active transitions.
            pending.current?.abort(); pending.current = null;
            setSelection(null); setMessage(""); setBusy(false);
        });
        return () => { active.current = false; subscription.remove(); pending.current?.abort(); pending.current = null; };
    }, [applePlaceId, disabled, focused, readSavedId]);

    async function lookUp() {
        if (!active.current || !current.current.focused || current.current.disabled || current.current.applePlaceId !== applePlaceId || current.current.readSavedId !== readSavedId
            || pending.current || (!applePlaceId && !readSavedId) || !available || !supported) return;
        const controller = new AbortController(); pending.current = controller;
        const ownsResponse = () => active.current && !controller.signal.aborted && pending.current === controller
            && current.current.focused && !current.current.disabled && current.current.applePlaceId === applePlaceId
            && current.current.readSavedId === readSavedId;
        setBusy(true); setSelection(null); setMessage("");
        try {
            // Identifier lookup, not address search. Address serialization also
            // permits unnamed map items; no originating search mode is stored.
            const savedId = readSavedId ? await readSavedId(controller.signal) : applePlaceId;
            if (!ownsResponse()) return;
            if (!savedId) { setMessage("No Apple Place ID is saved for this place."); return; }
            const locations = await lookupApplePlace(savedId, "address", controller.signal);
            if (!ownsResponse()) return;
            // Membership, entry deletion/recreation or address invalidation may
            // have happened while the native lookup was pending. Fail closed.
            if (readSavedId && await readSavedId(controller.signal) !== savedId) {
                if (ownsResponse()) setMessage("The saved place or access changed. Refresh the restaurant before looking up again.");
                return;
            }
            if (!ownsResponse()) return;
            if (locations.length === 1) setSelection(locations[0]);
            else setMessage("No current Apple map result is available for this ID. Your saved information is unchanged.");
        } catch (error) {
            if (ownsResponse()) setMessage(appleSearchErrorMessage(error));
        } finally {
            if (pending.current === controller) {
                pending.current = null;
                if (active.current) setBusy(false);
            }
        }
    }

    if (!applePlaceId && !readSavedId) return <Text style={styles.message}>No Apple Place ID is saved for this place. An Apple Place ID is optional; map coordinates are saved separately.</Text>;
    if (!available) return <Text style={styles.message}>Apple map lookup requires a compatible local iOS debug build. Your saved information remains available.</Text>;
    if (!supported) return <Text style={styles.message}>Apple Place ID lookup requires iOS 18 or later and an updated local debug build. Your saved information remains available.</Text>;
    return <View>
        <Pressable accessibilityRole="button" disabled={!focused || disabled || busy} style={styles.secondaryButton} onPress={lookUp}>
            <Text style={styles.secondaryText}>Look up saved Apple Place ID</Text></Pressable>
        {busy && <Text accessibilityLiveRegion="polite" style={styles.message}>Looking up Apple Place ID...</Text>}
        {message !== "" && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
        {focused && selection && <>
            <DevMapKitPreview key={selection.id} selection={selection} saved={null} />
            <Text style={styles.message}>Current Apple map result: {selection.name}{"\n"}{selection.address}</Text>
            <Text style={styles.message}>Apple map details are temporary. Your saved information is unchanged.</Text>
        </>}
    </View>;
}
