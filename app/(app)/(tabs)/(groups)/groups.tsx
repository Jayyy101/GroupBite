import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { groupErrorMessage } from "@/lib/group-errors";
import { accountAccessToken } from "@/lib/account-session";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import { useGroupCreation } from "@/providers/group-creation";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { Group, JoinRequest } from "@/types/database";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

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
    const [name, setName] = useState("");
    const currentName = useRef(name); currentName.current = name;
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState("");
    const [loadError, setLoadError] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [requesting, setRequesting] = useState(false);
    const [requestMessage, setRequestMessage] = useState("");
    const [requests, setRequests] = useState<Pick<JoinRequest, "id" | "status" | "requested_at">[]>([]);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const creation = useGroupCreation();
    const [confirmNewCreation, setConfirmNewCreation] = useState(false);
    const [reviewedCreation, setReviewedCreation] = useState(false);
    const reviewRequested = useRef<typeof creation.attempt>(null);
    const currentCreation = useRef(creation.attempt); currentCreation.current = creation.attempt;
    const busy = creating || requesting || creation.attempt?.status === "pending";
    const isFocused = useIsFocused();
    const { version: foregroundVersion, isActive } = useForegroundRefresh();
    const mounted = useRef(false), submitting = useRef(false);
    const lifecycleEpoch = useRef(0);
    const visible = useRef(false);
    visible.current = isFocused && isActive;
    const leave = useLeaveGuard({ userId, dirty: name !== "" || inviteCode !== "", busy,
        onDiscard: () => { setName(""); setInviteCode(""); setError(""); setRequestMessage(""); } });
    useEffect(() => { setReviewedCreation(false); setConfirmNewCreation(false); }, [creation.attempt]);
    useEffect(() => {
        mounted.current = true;
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") { lifecycleEpoch.current++; visible.current = false; }
        });
        return () => { mounted.current = false; subscription.remove(); };
    }, []);

    useEffect(() => {
        setGroups([]);
        setRequests([]);
        setLoading(true);
        if (!isFocused || !isActive) return;
        let active = true;
        let pending = false;
        async function loadGroups() {
            if (pending) return;
            pending = true;
            setLoadError("");
            try {
                const [groupsResult, requestsResult] = await Promise.all([
                    supabase.from("groups").select("*").order("created_at", { ascending: false }),
                    supabase.from("join_requests").select("id,group_id,status,requested_at").eq("user_id", userId).order("requested_at", { ascending: false }),
                ]);
                if (groupsResult.error) throw groupsResult.error;
                if (requestsResult.error) throw requestsResult.error;
                if (active) {
                    setGroups(groupsResult.data);
                    // The group card replaces an approved request once membership is visible.
                    setRequests(requestsResult.data.filter(request =>
                        request.status !== "approved" || !groupsResult.data.some(group => group.id === request.group_id)
                    ));
                    if (reviewRequested.current && reviewRequested.current === currentCreation.current) setReviewedCreation(true);
                }
            } catch {
                if (active) {
                    setGroups([]);
                    setRequests([]);
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

    async function handleCreate() {
        if (!mounted.current || !visible.current || currentName.current !== name || submitting.current || busy || loading || creation.attempt) return;
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
            if (!mounted.current || !visible.current || lifecycleEpoch.current !== epoch || AppState.currentState !== "active") return;
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
            setName("");
            setRefreshVersion(value => value + 1);
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

    async function handleRequest() {
        if (!mounted.current || !visible.current || submitting.current || busy || loading) return;
        setError("");
        setRequestMessage("");
        if (inviteCode.trim() === "") {
            setError("Please enter an invite code.");
            return;
        }
        setRequesting(true);
        submitting.current = true;
        try {
            const token = await accountAccessToken(userId);
            if (!mounted.current || !visible.current) return;
            const { error } = await supabase.rpc("request_group_access", { invite_code: inviteCode.trim() }).setHeader("Authorization", `Bearer ${token}`).retry(false);
            if (error) throw error;
            if (!mounted.current) return;
            setInviteCode("");
            setRequestMessage("Request sent. The Owner must approve it before you can access the group.");
            setRefreshVersion(value => value + 1);
        } catch (error) {
            if (mounted.current) setError(groupErrorMessage(error));
        } finally {
            submitting.current = false;
            if (mounted.current) setRequesting(false);
        }
    }

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
                            creation.acknowledge(creation.attempt); setConfirmNewCreation(false); setName(""); setError("");
                        }} style={styles.secondaryButton}><Text style={styles.secondaryText}>I Understand — Start a New Group</Text></Pressable>
                    </View>
                    </ScrollView>
                </View>
            </Modal>}
            <Text style={styles.title}>Groups</Text>
            {creation.attempt?.status === "uncertain" && <>
                <Text accessibilityLiveRegion="polite" style={styles.error}>Creation of &quot;{creation.attempt.name}&quot; is unconfirmed. Create Group is locked; no automatic retry will occur.</Text>
                <Pressable accessibilityRole="button" disabled={loading || busy} onPress={() => { reviewRequested.current = creation.attempt; setReviewedCreation(false); setRefreshVersion(value => value + 1); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Review Groups After Creation</Text></Pressable>
                {reviewedCreation && !loading && !loadError && <Pressable accessibilityRole="button" onPress={() => setConfirmNewCreation(true)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Start a Separate Group</Text></Pressable>}
            </>}
            <Text style={styles.label}>New group name</Text>
            <TextInput
                accessibilityLabel="New group name"
                value={name}
                onChangeText={setName}
                placeholder="Enter a group name"
                placeholderTextColor="#79665E"
                maxLength={100}
                editable={!busy && !creation.attempt}
                style={styles.input}
            />
            <Pressable accessibilityRole="button" disabled={loading || busy || !!creation.attempt} onPress={handleCreate} style={[styles.secondaryButton, (loading || busy || !!creation.attempt) && styles.disabled]}>
                <Text style={styles.secondaryText}>{creating ? "Creating..." : "Create Group"}</Text>
            </Pressable>
            <Text style={styles.label}>Join a private group</Text>
            <TextInput
                accessibilityLabel="Invite code"
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="Paste an invite code"
                placeholderTextColor="#79665E"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                maxLength={64}
                editable={!busy}
                style={styles.input}
            />
            <Pressable accessibilityRole="button" disabled={loading || busy} onPress={handleRequest} style={[styles.secondaryButton, (loading || busy) && styles.disabled]}>
                <Text style={styles.secondaryText}>{requesting ? "Sending request..." : "Request Access"}</Text>
            </Pressable>
            {requestMessage !== "" && <Text style={styles.message}>{requestMessage}</Text>}
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {loadError !== "" && <Text style={styles.error}>{loadError}</Text>}
            {loading ? <Text style={styles.message}>Loading groups...</Text> : (
                <>
                    {groups.length > 0 && (
                        <Pressable accessibilityRole="button" disabled={busy} onPress={() => leave.requestLeave(() => router.push("/add-visit"))} style={styles.primaryButton}>
                            <Text style={styles.primaryText}>Add Restaurant / Visit</Text>
                        </Pressable>
                    )}
                    {loadError === "" && groups.length === 0 && <Text style={styles.message}>No groups yet. Create your first group above!</Text>}
                    {groups.map(group => (
                        <Pressable key={group.id} accessibilityRole="button" disabled={busy} onPress={() => leave.requestLeave(() => router.push({ pathname: "/group/[id]", params: { id: group.id } }, { withAnchor: true }))} style={styles.card}>
                            <View style={styles.cardBody}>
                                <View style={styles.cardHeading}>
                                    <Text style={[styles.cardTitle, styles.cardHeadingText]}>{group.name}</Text>
                                    <Ionicons name="chevron-forward" size={18} color="#79665E" accessible={false} importantForAccessibility="no" />
                                </View>
                                <Text style={[styles.message, styles.cardMessage]}>{group.owner_user_id === userId ? "Owner" : "Member"}</Text>
                            </View>
                        </Pressable>
                    ))}
                    {requests.length > 0 && <Text style={styles.label}>Your join requests</Text>}
                    {requests.map(request => (
                        <View key={request.id} style={styles.card}>
                            <Text style={styles.cardTitle}>
                                {request.status === "pending" ? "Pending approval" : request.status === "approved" ? "Previously approved" : "Denied"}
                            </Text>
                            {request.status === "approved" && <Text style={styles.message}>This past approval does not grant current access. To rejoin, request access with an active invite code.</Text>}
                            <Text style={styles.message}>Requested {new Date(request.requested_at).toLocaleDateString()}</Text>
                        </View>
                    ))}
                </>
            )}
            <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => setRefreshVersion(value => value + 1)} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Refresh Groups and Requests</Text>
            </Pressable>
        </ScreenScaffold>
    );
}
