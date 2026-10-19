import { ScreenScaffold } from "@/components/screen-scaffold";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { accountAccessToken } from "@/lib/account-session";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { useGroupCreation } from "@/providers/group-creation";
import { backendStyles as styles } from "@/styles/backend";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, TextInput } from "react-native";

export default function CreateGroupScreen() {
    const { session, loading } = useAuth();
    return !loading && session ? <CreateGroupForm key={session.user.id} userId={session.user.id} /> : null;
}

function CreateGroupForm({ userId }: { userId: string }) {
    const router = useRouter();
    const { session, loading } = useAuth();
    const creation = useGroupCreation();
    const [name, setName] = useState("");
    const currentName = useRef(name); currentName.current = name;
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState(false);
    const [error, setError] = useState("");
    const isFocused = useIsFocused();
    const { isActive } = useForegroundRefresh();
    const mounted = useRef(false), submitting = useRef(false), completed = useRef(false);
    const lifecycleEpoch = useRef(0), visible = useRef(false);
    visible.current = isFocused && isActive && !loading && session?.user.id === userId;
    const busy = creating || creation.attempt?.status === "pending";
    const canOperate = () => mounted.current && visible.current && AppState.currentState === "active";
    // The unsent one-field draft is route-local; only pending/uncertain work guards exits.
    const leave = useLeaveGuard({ userId, dirty: false, busy,
        uncertain: creation.attempt?.status === "uncertain",
        uncertainExitMessage: "The group may already have been created, or may still finish. Leaving does not cancel the request or unlock another creation. Return to Groups to review it before starting a separate group.",
        onDiscard: () => { setName(""); setError(""); } });

    useEffect(() => {
        mounted.current = true;
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") { lifecycleEpoch.current++; visible.current = false; }
        });
        return () => { mounted.current = false; subscription.remove(); };
    }, []);

    function returnToGroups() {
        if (!canOperate() || submitting.current) return;
        leave.requestLeave(() => router.dismissTo("/groups", { withAnchor: true }));
    }

    async function handleCreate() {
        if (!canOperate() || completed.current || currentName.current !== name || submitting.current || busy || creation.attempt) return;
        setError("");
        if (name.trim() === "") {
            setError("Please enter a group name.");
            return;
        }
        setCreating(true);
        submitting.current = true;
        let attempt: ReturnType<typeof creation.begin> = null;
        let sent = false;
        let rejected = false;
        const epoch = lifecycleEpoch.current;
        try {
            const token = await withRequestDeadline(() => accountAccessToken(userId));
            if (!canOperate() || lifecycleEpoch.current !== epoch) return;
            const startedAttempt = creation.begin(name.trim());
            if (!startedAttempt) return;
            attempt = startedAttempt;
            sent = true;
            const result = await withRequestDeadline(signal => supabase.rpc("create_group", { group_name: startedAttempt.name }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
            if (result.error) {
                rejected = result.status >= 400 && result.status < 500 && !!result.error.code;
                throw result.error;
            }
            if (!result.data?.id) throw new Error("Could not confirm the created group identity.");
            creation.settle(attempt, false);
            if (!mounted.current) return;
            completed.current = true;
            setCreated(true);
            setName("");
            // A response arriving while away must not redirect the current screen.
            if (canOperate() && lifecycleEpoch.current === epoch) {
                leave.finish(() => router.dismissTo("/groups", { withAnchor: true }));
            }
        } catch {
            if (attempt) creation.settle(attempt, sent && !rejected);
            if (mounted.current) setError(sent && !rejected
                ? "The group may already have been created. Review your groups before starting another creation."
                : "Could not create the group. Check your connection and try again.");
        } finally {
            submitting.current = false;
            if (mounted.current) setCreating(false);
        }
    }

    return <ScreenScaffold edgeToEdge includeBottomInset onBack={returnToGroups} busy={busy}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        {leave.confirmation}
        <Text style={styles.title}>Create a Group</Text>
        {creation.attempt && <Text accessibilityLiveRegion="polite" style={creation.attempt.status === "uncertain" ? styles.error : styles.message}>
            Creation of &quot;{creation.attempt.name}&quot; is {creation.attempt.status === "uncertain" ? "unconfirmed" : "in progress"}. Another creation is locked; no automatic retry will occur.
        </Text>}
        {created && <Text accessibilityLiveRegion="polite" style={styles.message}>Group created. Return to Groups to view it.</Text>}
        <Text style={styles.label}>New group name</Text>
        <TextInput accessibilityLabel="New group name" value={name} onChangeText={setName}
            placeholder="Enter a group name" placeholderTextColor="#79665E" maxLength={100}
            editable={!busy && !creation.attempt && !created} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={busy || !!creation.attempt || created} onPress={handleCreate}
            style={[styles.primaryButton, (busy || !!creation.attempt || created) && styles.disabled]}>
            <Text style={styles.primaryText}>{creating ? "Creating..." : "Create Group"}</Text>
        </Pressable>
        {error !== "" && <Text style={styles.error}>{error}</Text>}
        {creation.attempt?.status === "uncertain" && <Pressable accessibilityRole="button" onPress={returnToGroups} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Review Groups After Creation</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={returnToGroups} style={[styles.secondaryButton, busy && styles.disabled]}>
            <Text style={styles.secondaryText}>{created ? "View Groups" : "Cancel"}</Text>
        </Pressable>
    </ScreenScaffold>;
}
