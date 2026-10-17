import { useAuth } from "@/providers/auth";
import { TabLeaveContext } from "@/providers/tab-leave";
import { backendStyles as styles } from "@/styles/backend";
import { useIsFocused, useNavigation, usePreventRemove } from "@react-navigation/native";
import { useContext, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

type Options = {
    userId: string | undefined;
    resetKey?: string;
    dirty: boolean;
    busy?: boolean;
    uncertain?: boolean;
    retainUncertain?: boolean;
    uncertainExitMessage?: string;
    onDiscard?: () => void;
};

export function useLeaveGuard(options: Options) {
    const { session } = useAuth();
    const navigation = useNavigation();
    const focused = useIsFocused();
    const tabLeave = useContext(TabLeaveContext);
    const latest = useRef(options);
    latest.current = options;
    const alive = useRef(true);
    const account = useRef(false);
    account.current = !!session && session.user.id === options.userId;
    const pending = useRef<(() => void) | null>(null);
    const discarding = useRef(false);
    const identityKey = JSON.stringify([options.userId, options.resetKey]);
    const identity = useRef({ key: identityKey });
    if (identity.current.key !== identityKey) { identity.current = { key: identityKey }; pending.current = null; }
    const owner = identity.current;
    const [prompt, setPrompt] = useState(false);
    const [approved, setApproved] = useState(false);
    const protectedDraft = options.dirty || options.busy || options.uncertain;

    function requestLeave(leave: () => void) {
        if (!alive.current || !account.current || identity.current !== owner) return;
        const current = latest.current;
        if (!current.dirty && !current.busy && !current.uncertain) { leave(); return; }
        if (pending.current) return;
        pending.current = leave;
        setPrompt(true);
    }
    function stay() { if (!alive.current || !account.current || identity.current !== owner) return; pending.current = null; setPrompt(false); }
    function discard() {
        if (!alive.current || !account.current || identity.current !== owner || latest.current.busy || (latest.current.uncertain && latest.current.retainUncertain) || !pending.current) return;
        discarding.current = true;
        setPrompt(false);
        setApproved(true);
    }
    // Successful saves must bypass draft protection after native-stack has
    // received the updated usePreventRemove state, including cross-tab saves.
    function finish(leave: () => void) {
        if (!alive.current || !account.current || identity.current !== owner) return;
        pending.current = leave;
        discarding.current = false;
        setPrompt(false);
        setApproved(true);
    }
    usePreventRemove(account.current && !approved && !!protectedDraft, ({ data }) => {
        requestLeave(() => navigation.dispatch(data.action));
    });
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; pending.current = null; };
    }, []);
    useEffect(() => { setPrompt(false); setApproved(false); }, [owner]);
    useEffect(() => {
        if (!approved || !account.current) return;
        const leave = pending.current;
        pending.current = null;
        if (discarding.current) latest.current.onDiscard?.();
        leave?.();
    }, [approved]);
    useEffect(() => {
        if (!tabLeave || !focused || !protectedDraft || approved) return;
        tabLeave.current = requestLeave;
        return () => { if (tabLeave.current === requestLeave) tabLeave.current = null; };
    });

    useEffect(() => {
        if (!focused || !protectedDraft) setApproved(false);
    }, [focused, protectedDraft]);

    const confirmation = prompt && <Modal visible transparent animationType="fade" onRequestClose={stay}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
            <View accessibilityViewIsModal style={styles.card}>
                <Text style={styles.cardTitle}>{options.busy ? "Save in progress" : options.uncertain ? "Review this save before leaving" : "Discard unsaved changes?"}</Text>
                <Text style={styles.message}>{options.busy ? "Stay while this submission finishes." : options.uncertain
                    ? options.uncertainExitMessage ?? "This change may already have been saved. Review the saved result before making another change."
                    : "Your changes will be cleared without saving."}</Text>
                <Pressable accessibilityRole="button" onPress={stay} style={styles.primaryButton}><Text style={styles.primaryText}>Stay</Text></Pressable>
                {!options.busy && !(options.uncertain && options.retainUncertain) && <Pressable accessibilityRole="button" onPress={discard} style={styles.secondaryButton}><Text style={styles.secondaryText}>{options.uncertain && options.uncertainExitMessage ? "Leave Anyway" : "Discard"}</Text></Pressable>}
            </View>
            </ScrollView>
        </View>
    </Modal>;
    return { requestLeave, finish, confirmation };
}
