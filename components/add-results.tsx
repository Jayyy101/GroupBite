import { useUnifiedAdd } from "@/providers/unified-add";
import { backendStyles as styles } from "@/styles/backend";
import type { AddDestinationResult } from "@/types/database";
import type { AddState } from "@/lib/unified-add";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

type ResultActions = { canOperate: () => boolean; open: (result: AddDestinationResult) => void };
export function AddResults({ canOperate, done, open, separate }: ResultActions & {
    done: () => void | Promise<void>;
    separate: (expected: AddState, temporary: boolean) => Promise<"started" | "storage-unavailable" | "stale">;
}) {
    const { coordinator, state } = useUnifiedAdd();
    const [confirmation, setConfirmation] = useState<AddState | null>(null), [temporary, setTemporary] = useState(false);
    const [separateMessage, setSeparateMessage] = useState("");
    const alive = useRef(false), pending = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function confirmSeparate() {
        if (!alive.current || pending.current || !canOperate() || !confirmation || coordinator.state.busy) return;
        pending.current = true;
        try {
            const result = await separate(confirmation, temporary);
            if (!alive.current || !canOperate()) return;
            if (result === "storage-unavailable") { setTemporary(true); setConfirmation(coordinator.state); }
            else {
                setConfirmation(null); setTemporary(false);
                if (result === "stale") setSeparateMessage("Could not start a separate Add. Review the current results and session before trying again.");
            }
        } finally { pending.current = false; }
    }
    const allSaved = state.attempts.length > 0 && state.attempts.every(attempt => attempt.status === "saved");
    return <View>
        <Text style={styles.title}>{state.busy ? "Saving destinations..." : allSaved ? "Saved" : "Review save results"}</Text>
        {!allSaved && <Text style={styles.message}>Each destination saves independently. Confirmed saves are kept. Checking results only reads receipts.</Text>}
        {state.attempts.map(attempt => <View key={attempt.requestId} style={styles.card}>
            <Text style={styles.cardTitle}>{attempt.destination.label}</Text>
            <Text style={styles.message}>{attempt.status === "saved" ? "Confirmed saved" : attempt.status === "failed" ? "Confirmed not saved"
                : attempt.status === "pending" ? "Pending — not sent" : "Uncertain — check saved result"}</Text>
            {!!attempt.message && <Text style={styles.message}>{attempt.message}</Text>}
            {attempt.status === "saved" && attempt.result?.available && <Pressable accessibilityRole="button" disabled={state.busy}
                accessibilityLabel={`Open ${attempt.destination.label}`}
                onPress={() => {
                    const current = coordinator.state.attempts.find(a => a.requestId === attempt.requestId);
                    if (!coordinator.state.busy && current?.status === "saved" && current.result?.available && canOperate()) open(current.result);
                }} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Open {attempt.destination.label}</Text></Pressable>}
            {attempt.status === "failed" && attempt.submission && <Pressable accessibilityRole="button" disabled={state.busy}
                accessibilityLabel={`Retry ${attempt.destination.label}`}
                onPress={() => { if (!coordinator.state.busy && canOperate()) void coordinator.sendPending(canOperate, attempt.requestId); }} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Retry {attempt.destination.label}</Text></Pressable>}
        </View>)}
        {state.error !== "" && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
        <Pressable accessibilityRole="button" disabled={state.busy} onPress={() => { if (!coordinator.state.busy && canOperate()) void coordinator.reconcile(canOperate); }} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Check Saved Results</Text></Pressable>
        {state.attempts.some(a => a.status === "pending" && a.submission) && <Pressable accessibilityRole="button" disabled={state.busy}
            onPress={() => { if (!coordinator.state.busy && canOperate()) void coordinator.sendPending(canOperate); }} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Continue Unsent Destinations</Text></Pressable>}
        <Pressable accessibilityRole="button" disabled={state.busy} onPress={() => { if (!coordinator.state.busy && canOperate()) return done(); }} style={styles.primaryButton}>
            <Text style={styles.primaryText}>{allSaved ? "Done" : "Finish Reviewing"}</Text></Pressable>
        {separateMessage !== "" && <Text accessibilityLiveRegion="polite" style={styles.message}>{separateMessage}</Text>}
        {!allSaved && !confirmation && <Pressable accessibilityRole="button" disabled={state.busy || !state.ready} style={styles.secondaryButton}
            onPress={() => { if (alive.current && !pending.current && canOperate() && !coordinator.state.busy) { setSeparateMessage(""); setTemporary(false); setConfirmation(coordinator.state); } }}>
            <Text style={styles.secondaryText}>Start a separate Add</Text></Pressable>}
        {confirmation && <View style={styles.card}>
            <Text style={styles.cardTitle}>{temporary ? "Recovery storage is unavailable" : "Start a separate Add?"}</Text>
            <Text style={styles.message}>Earlier uncertain saves may already have succeeded or may finish later. A separate save can add another visit. Confirmed saves remain saved.</Text>
            <Text style={styles.message}>{temporary
                ? "Previous recovery could not be preserved on this device. Known request markers will remain only in memory; unreadable request IDs may be unavailable. Restart or sign-out may lose this access, and the old recovery screen may return. A fresh draft can open, but new saves stay paused until recovery can be stored safely."
                : "Previous request markers will be kept under Previous save recovery, with read-only receipt checks; unusable evidence may require reviewing My Places and your groups."}</Text>
            <Text style={styles.message}>This does not cancel or retry the earlier save, and it does not undo any saved visit. Review your destinations before saving again.</Text>
            {state.historyError !== "" && <Text style={styles.error}>{state.historyError}</Text>}
            <Pressable accessibilityRole="button" disabled={state.busy} style={styles.primaryButton} onPress={confirmSeparate}>
                <Text style={styles.primaryText}>{temporary ? "Start with temporary recovery" : "Confirm separate Add"}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={state.busy} style={styles.secondaryButton} onPress={() => {
                if (alive.current && !pending.current && canOperate()) { setConfirmation(null); setTemporary(false); }
            }}><Text style={styles.secondaryText}>Keep reviewing this save</Text></Pressable>
        </View>}
    </View>;
}

// Archived attempts have no frozen mutation payload and expose no retry action.
export function PreviousAddResults({ canOperate, open }: ResultActions) {
    const { coordinator, state } = useUnifiedAdd();
    const [expanded, setExpanded] = useState(false);
    if (!state.previous.length && !state.historyError) return null;
    return <View>
        {state.historyError !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{state.historyError}</Text>}
        {state.previous.some(previous => !previous.durable) && <Text style={styles.error}>Previous recovery is temporary. Restart or sign-out may lose access; new saves need recovery storage to work.</Text>}
        {state.historyError !== "" && <Pressable accessibilityRole="button" disabled={state.busy} style={styles.secondaryButton}
            onPress={() => { if (canOperate() && !coordinator.state.busy) void coordinator.refreshPrevious(canOperate); }}>
            <Text style={styles.secondaryText}>Retry previous recovery read</Text></Pressable>}
        {state.previous.length > 0 && <Pressable accessibilityRole="button" disabled={state.busy} style={styles.secondaryButton}
            onPress={() => { if (canOperate() && !coordinator.state.busy) setExpanded(value => !value); }}>
            <Text style={styles.secondaryText}>{expanded ? "Hide previous save recovery" : "Previous save recovery"}</Text></Pressable>}
        {expanded && state.previous.map((record, index) => <View style={styles.card} key={record.id}>
            <Text style={styles.cardTitle}>Previous save {index + 1}</Text>
            {!record.durable && <Text style={styles.error}>Temporary recovery only. Restart or sign-out may lose access.</Text>}
            {record.unreadable && <Text style={styles.message}>Some original evidence could not be read. Available request IDs can be checked below; also review My Places and your groups.</Text>}
            {record.attempts.map(attempt => <View key={attempt.requestId}>
                <Text style={styles.message}>{attempt.destination.label}: {attempt.status === "saved" ? "Confirmed saved" : attempt.status === "failed" ? "Confirmed not saved"
                    : attempt.status === "pending" ? "Not sent" : "Uncertain — check saved result"}</Text>
                {!!attempt.message && <Text style={styles.message}>{attempt.message}</Text>}
                {attempt.status === "saved" && attempt.result?.available && <Pressable accessibilityRole="button" disabled={state.busy} style={styles.secondaryButton}
                    onPress={() => {
                        const current = coordinator.state.previous.find(row => row.id === record.id)?.attempts.find(row => row.requestId === attempt.requestId);
                        if (canOperate() && !coordinator.state.busy && current?.status === "saved" && current.result?.available) open(current.result);
                    }}><Text style={styles.secondaryText}>Open previous {attempt.destination.label}</Text></Pressable>}
            </View>)}
            {record.attempts.length > 0 && <Pressable accessibilityRole="button" disabled={state.busy} style={styles.secondaryButton}
                onPress={() => { if (canOperate() && !coordinator.state.busy) void coordinator.checkPrevious(record.id, canOperate); }}>
                <Text style={styles.secondaryText}>Check previous save {index + 1}</Text></Pressable>}
        </View>)}
    </View>;
}
