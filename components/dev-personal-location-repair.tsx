// Temporary: remove this component and its detail-screen mount before friends
// testing. Both the UI and the mutation helper independently require __DEV__.
import { RestaurantSearch } from "@/components/restaurant-search";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { appleSearchAvailable } from "@/lib/apple-map-search";
import { attachPersonalMapkitLocation, DEV_PERSONAL_LOCATION_REPAIR_ENABLED, reviewPersonalLocationRepair, type RepairReview } from "@/lib/personal-location-repair";
import { backendStyles as styles } from "@/styles/backend";
import type { AddRestaurant, PersonalPlace } from "@/types/database";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";

export default function DevPersonalLocationRepair(props: { userId: string; place: PersonalPlace; disabled: boolean; onLockChange: (locked: boolean) => void }) {
    return __DEV__ && DEV_PERSONAL_LOCATION_REPAIR_ENABLED && appleSearchAvailable() ? <RepairPanel {...props} /> : null;
}

function RepairPanel({ userId, place, disabled, onLockChange }: { userId: string; place: PersonalPlace; disabled: boolean; onLockChange: (locked: boolean) => void }) {
    const [review, setReview] = useState<RepairReview | null>(null);
    const [open, setOpen] = useState(false), [selection, setSelection] = useState<AddRestaurant | null>(null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
    const alive = useRef(false), pending = useRef(false), epoch = useRef(0);
    const selected = useRef<AddRestaurant | null>(null), opened = useRef(false);
    const latest = useRef({ disabled, place }); latest.current = { disabled, place };
    const uncertain = review?.status === "uncertain" || review?.status === "pending";
    const canOperate = () => alive.current && !latest.current.disabled && latest.current.place === place && AppState.currentState === "active";
    const leave = useLeaveGuard({ userId, resetKey: place.id, dirty: !!selection, busy, uncertain,
        uncertainExitMessage: "This location may already be attached. Leaving does not undo it. Reopen the place and check its saved location before continuing.",
        onDiscard: () => { selected.current = null; opened.current = false; setSelection(null); setOpen(false); } });
    useEffect(() => { onLockChange(open || busy || uncertain); }, [open, busy, uncertain, onLockChange]);
    useEffect(() => {
        alive.current = true;
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") { epoch.current++; selected.current = null; opened.current = false; setSelection(null); setOpen(false); }
        });
        void check();
        return () => { alive.current = false; subscription.remove(); };
        // Account/card lifetimes are keyed by the authorized detail screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function check() {
        if (!canOperate() || pending.current) return;
        pending.current = true; setBusy(true); setMessage("");
        const generation = epoch.current;
        try {
            const result = await reviewPersonalLocationRepair(userId, place);
            if (canOperate() && generation === epoch.current) { setReview(result); selected.current = null; opened.current = false; setSelection(null); setOpen(false); }
        } catch {
            if (canOperate() && generation === epoch.current) setMessage("Could not verify the saved location. Check again before continuing.");
        } finally { pending.current = false; if (alive.current) setBusy(false); }
    }
    async function attach() {
        if (!canOperate() || pending.current || !opened.current || !open || !selection || selected.current !== selection || review?.status !== "missing" || !review.snapshot) return;
        pending.current = true; setBusy(true); setMessage("");
        const generation = epoch.current;
        // Keep the original baseline/revision and native selection through await.
        const baseline = review.snapshot, chosen = selection;
        try {
            const result = await attachPersonalMapkitLocation(userId, baseline, chosen, () => canOperate() && generation === epoch.current);
            if (canOperate() && generation === epoch.current) { setReview(result); selected.current = null; opened.current = false; setSelection(null); setOpen(false); }
        } catch {
            if (canOperate() && generation === epoch.current) {
                setReview(null); selected.current = null; opened.current = false; setSelection(null); setOpen(false);
                setMessage("Repair was not sent. Check the saved restaurant and select its location again.");
            }
        } finally { pending.current = false; if (alive.current) setBusy(false); }
    }
    const locked = disabled || busy;
    return <View>
        {leave.confirmation}
        {busy && <Text accessibilityLiveRegion="polite" style={styles.message}>Checking restaurant and map location...</Text>}
        {review?.status === "missing" && !open && <Pressable accessibilityRole="button" disabled={locked} style={styles.secondaryButton}
            onPress={() => { if (canOperate() && !pending.current) { opened.current = true; setOpen(true); setMessage(""); } }}>
            <Text style={styles.secondaryText}>Add missing map location</Text></Pressable>}
        {open && review?.status === "missing" && <View style={styles.card}>
            <Text style={styles.cardTitle}>Attach a map location · Development only</Text>
            <Text style={styles.message}>Select this exact restaurant in Apple Maps. Confirming attaches coordinates only; it adds no visit and changes no saved restaurant fields.</Text>
            <Text style={styles.label}>Existing My Places restaurant</Text>
            <Text style={styles.message}>{place.name}{"\n"}{place.address}</Text>
            {!selection ? <RestaurantSearch disabled={locked} selectionHint="Select the exact saved restaurant to review a location-only attachment."
                onSelect={value => { if (canOperate() && opened.current && !pending.current && value.mapkit_point) { selected.current = value; setSelection(value); } }} /> : <>
                <Text style={styles.label}>Selected Apple Maps result</Text>
                <Text style={styles.message}>{selection.name}{"\n"}{selection.address}</Text>
                <Text style={styles.message}>Confirm only if both identify the same restaurant. An Apple Place ID is optional.</Text>
                <Pressable accessibilityRole="button" disabled={locked} onPress={attach} style={styles.primaryButton}>
                    <Text style={styles.primaryText}>Attach location only</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={locked} onPress={() => { if (canOperate() && !pending.current) { selected.current = null; setSelection(null); } }} style={styles.secondaryButton}>
                    <Text style={styles.secondaryText}>Choose a different location</Text></Pressable>
            </>}
            <Pressable accessibilityRole="button" disabled={locked} onPress={() => { if (canOperate() && !pending.current) { selected.current = null; opened.current = false; setSelection(null); setOpen(false); } }} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Cancel location repair</Text></Pressable>
        </View>}
        {review?.status === "confirmed" && <Text accessibilityLiveRegion="polite" style={styles.message}>Location attachment verified. The restaurant and visit history are unchanged. Refresh My Places Map to see the pin.</Text>}
        {uncertain && <Text accessibilityLiveRegion="polite" style={styles.error}>The attachment is not confirmed. Only read-only checks are available; this repair will not be sent again.</Text>}
        {review?.status === "changed" && <Text style={styles.error}>The restaurant or visit history changed. Repair is stopped. Refresh the place and review before continuing.</Text>}
        {message !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>}
        {(uncertain || !review || review.status === "changed") && <Pressable accessibilityRole="button" disabled={locked} onPress={check} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Check saved location</Text></Pressable>}
    </View>;
}
