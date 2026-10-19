import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { supabase } from "@/lib/supabase";
import { useGroupCreation } from "@/providers/group-creation";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { Group } from "@/types/database";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function GroupsScreen() {
    const router = useRouter();
    const { session, loading, error } = useAuth();

    if (!loading && session) {
        // Remount when the account changes so one user's groups never carry over.
        return <SignedInGroups key={session.user.id} userId={session.user.id} />;
    }

    return (
        <ScreenScaffold>
            <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>Groups</Text>
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            <Text style={styles.message}>{loading ? "Restoring your session..." : "Sign in to create and view your private groups."}</Text>
            {!loading && (
                <Pressable accessibilityRole="button" onPress={() => router.replace("/auth")} style={styles.primaryButton}>
                    <Text style={styles.primaryText}>Sign In / Sign Up</Text>
                </Pressable>
            )}
        </ScreenScaffold>
    );
}

function SignedInGroups({ userId }: { userId: string }) {
    const router = useRouter();
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const creation = useGroupCreation();
    const [confirmNewCreation, setConfirmNewCreation] = useState(false);
    const [reviewedCreation, setReviewedCreation] = useState(false);
    const [creationExitVersion, setCreationExitVersion] = useState(0);
    const reviewRequested = useRef<typeof creation.attempt>(null);
    const currentCreation = useRef(creation.attempt); currentCreation.current = creation.attempt;
    const busy = creation.attempt?.status === "pending";
    const isFocused = useIsFocused();
    const { version: foregroundVersion, isActive } = useForegroundRefresh();
    const mounted = useRef(false);
    const visible = useRef(false);
    visible.current = isFocused && isActive;
    const leave = useLeaveGuard({ userId, resetKey: String(creationExitVersion), dirty: false, busy,
        uncertain: creation.attempt?.status === "uncertain",
        uncertainExitMessage: "The group may already have been created, or may still finish. Leaving does not cancel the request or unlock another creation. Return to Groups to review it before starting a separate group.",
        onDiscard: () => {
            // A root-tab reselect does not blur Groups; rearm its retained recovery guard.
            if (creation.attempt?.status === "uncertain") setCreationExitVersion(value => value + 1);
        } });
    useEffect(() => { setReviewedCreation(false); setConfirmNewCreation(false); }, [creation.attempt]);
    useEffect(() => {
        mounted.current = true;
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") visible.current = false;
        });
        return () => { mounted.current = false; subscription.remove(); };
    }, []);

    useEffect(() => {
        setGroups([]);
        setLoading(true);
        if (!isFocused || !isActive) return;
        let active = true;
        let pending = false;
        async function loadGroups() {
            if (pending) return;
            pending = true;
            try {
                const groupsResult = await supabase.from("groups").select("*").order("created_at", { ascending: false });
                if (groupsResult.error) throw groupsResult.error;
                if (active) {
                    setLoadError("");
                    setGroups(groupsResult.data);
                    if (reviewRequested.current && reviewRequested.current === currentCreation.current) setReviewedCreation(true);
                }
            } catch {
                if (active) {
                    setGroups([]);
                    setLoadError("Could not load your groups. Check your connection and refresh.");
                }
            } finally {
                pending = false;
                if (active) setLoading(false);
            }
        }
        loadGroups();
        const timer = setInterval(loadGroups, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [userId, isFocused, isActive, foregroundVersion, refreshVersion]);

    return (
        <ScreenScaffold keyboardShouldPersistTaps="handled">
            {leave.confirmation}
            {confirmNewCreation && <Modal visible transparent animationType="fade" onRequestClose={() => setConfirmNewCreation(false)}>
                <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>
                    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
                    <View accessibilityViewIsModal style={styles.card}>
                        <Text style={styles.cardTitle}>Another group could be a duplicate</Text>
                        <Text style={styles.message}>The earlier request may already have created a group, or may still finish. A refreshed list cannot prove that it failed. Check your groups before starting a separate creation.</Text>
                        <Pressable accessibilityRole="button" onPress={() => setConfirmNewCreation(false)} style={styles.primaryButton}><Text style={styles.primaryText}>Keep Creation Locked</Text></Pressable>
                        <Pressable accessibilityRole="button" onPress={() => {
                            if (!mounted.current || !visible.current || !creation.attempt || currentCreation.current !== creation.attempt) return;
                            creation.acknowledge(creation.attempt); setConfirmNewCreation(false);
                        }} style={styles.secondaryButton}><Text style={styles.secondaryText}>I Understand — Unlock Creation</Text></Pressable>
                    </View>
                    </ScrollView>
                </View>
            </Modal>}
            <Text style={styles.title}>Groups</Text>
            <Text style={styles.message}>Your shared restaurant memories, all in one place.</Text>
            {creation.attempt?.status === "uncertain" && <>
                <Text accessibilityLiveRegion="polite" style={styles.error}>Creation of &quot;{creation.attempt.name}&quot; is unconfirmed. Create Group is locked; no automatic retry will occur.</Text>
                <Pressable accessibilityRole="button" disabled={loading || busy} onPress={() => { reviewRequested.current = creation.attempt; setReviewedCreation(false); setRefreshVersion(value => value + 1); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Review Groups After Creation</Text></Pressable>
                {reviewedCreation && !loading && !loadError && <Pressable accessibilityRole="button" onPress={() => setConfirmNewCreation(true)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Start a Separate Group</Text></Pressable>}
            </>}
            {creation.attempt?.status === "pending" && <Text accessibilityLiveRegion="polite" style={styles.message}>Creation of &quot;{creation.attempt.name}&quot; is in progress. Another creation is locked.</Text>}
            <View style={homeStyles.sectionHeading}>
                <Text accessibilityRole="header" style={[styles.cardTitle, styles.cardHeadingText]}>{!loading && !loadError ? `Your Groups (${groups.length})` : "Your Groups"}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Refresh Groups" accessibilityState={{ disabled: busy || loading }}
                    disabled={busy || loading} onPress={() => setRefreshVersion(value => value + 1)} style={[homeStyles.refresh, (busy || loading) && styles.disabled]}>
                    <Ionicons name="refresh-outline" size={22} color="#C9472C" accessible={false} importantForAccessibility="no" />
                </Pressable>
            </View>
            {loadError !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{loadError}</Text>}
            {loading ? <Text style={styles.message}>Loading groups...</Text> : <>
                {loadError === "" && groups.length === 0 && <Text style={styles.message}>No groups yet. Create a group or join one with an invite code.</Text>}
                {groups.map(group => (
                    <Pressable key={group.id} accessibilityRole="button" disabled={busy}
                        onPress={() => leave.requestLeave(() => router.push({ pathname: "/group/[id]", params: { id: group.id } }, { withAnchor: true }))} style={styles.card}>
                        <View style={styles.cardHeading}>
                            <Ionicons name="people-outline" size={22} color="#79665E" accessible={false} importantForAccessibility="no" />
                            <View style={[styles.cardBody, styles.cardHeadingText]}>
                                <Text style={styles.cardTitle}>{group.name}</Text>
                                <Text style={[styles.message, styles.cardMessage]}>{group.owner_user_id === userId ? "Owner" : "Member"}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#79665E" accessible={false} importantForAccessibility="no" />
                        </View>
                    </Pressable>
                ))}
            </>}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => leave.requestLeave(() => router.push("/create-group"))} style={[styles.primaryButton, busy && styles.disabled]}>
                <Text style={styles.primaryText}>Create a Group</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => leave.requestLeave(() => router.push("/join-group"))} style={[styles.secondaryButton, busy && styles.disabled]}>
                <Text style={styles.secondaryText}>Join a Group</Text>
            </Pressable>
        </ScreenScaffold>
    );
}

const homeStyles = StyleSheet.create({
    sectionHeading: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    refresh: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
