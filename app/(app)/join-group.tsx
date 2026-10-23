import { ScreenScaffold } from "@/components/screen-scaffold";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { accountAccessToken } from "@/lib/account-session";
import { groupErrorMessage } from "@/lib/group-errors";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { useJoinRequest } from "@/providers/join-request";
import { backendStyles as styles } from "@/styles/backend";
import type { JoinRequest } from "@/types/database";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

export default function JoinGroupScreen() {
    const { session, loading } = useAuth();
    return !loading && session ? <JoinGroupForm key={session.user.id} userId={session.user.id} /> : null;
}

function JoinGroupForm({ userId }: { userId: string }) {
    const router = useRouter();
    const join = useJoinRequest();
    const currentJoin = useRef(join); currentJoin.current = join;
    const { session, loading: authLoading } = useAuth();
    const focused = useIsFocused();
    const { version: foregroundVersion, isActive } = useForegroundRefresh();
    const [inviteCode, setInviteCode] = useState("");
    const currentCode = useRef(inviteCode); currentCode.current = inviteCode;
    const [requesting, setRequesting] = useState(false);
    const [requestMessage, setRequestMessage] = useState("");
    const [error, setError] = useState("");
    const [requests, setRequests] = useState<Pick<JoinRequest, "id" | "group_id" | "status" | "requested_at">[]>([]);
    const [groupIds, setGroupIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [reviewed, setReviewed] = useState<typeof join.attempt>(null);
    const [confirmRetry, setConfirmRetry] = useState<typeof join.attempt>(null);
    const currentReview = useRef({ reviewed, confirmRetry }); currentReview.current = { reviewed, confirmRetry };
    const reviewRequested = useRef<typeof join.attempt>(null);
    const mounted = useRef(false), submitting = useRef(false), visible = useRef(false);
    const lifecycleEpoch = useRef(0);
    visible.current = focused && isActive && !authLoading && session?.user.id === userId;
    const canOperate = () => mounted.current && visible.current && AppState.currentState === "active";
    const busy = requesting || join.attempt?.status === "pending";
    const locked = !!join.attempt;
    // The unsent one-field draft is route-local; only pending/uncertain work guards exits.
    const leave = useLeaveGuard({ userId, resetKey: `${join.revision}:${foregroundVersion}`, dirty: false, busy,
        uncertain: join.attempt?.status === "uncertain",
        uncertainExitMessage: "Your membership request may already have been received, or may still finish. Leaving does not cancel it or unlock another submission. Return to Join a Group to review your request statuses before trying again.",
        onDiscard: () => { setInviteCode(""); setError(""); } });
    useEffect(() => { setReviewed(null); setConfirmRetry(null); reviewRequested.current = null; }, [join.attempt]);

    useEffect(() => {
        mounted.current = true;
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") {
                lifecycleEpoch.current++; visible.current = false;
                setReviewed(null); setConfirmRetry(null); reviewRequested.current = null;
            }
        });
        return () => { mounted.current = false; subscription.remove(); };
    }, []);
    useEffect(() => {
        if (!focused) {
            lifecycleEpoch.current++; visible.current = false;
            setReviewed(null); setConfirmRetry(null); reviewRequested.current = null;
        }
    }, [focused]);

    useEffect(() => {
        setRequests([]); setGroupIds([]); setLoading(true);
        if (!focused || !isActive) return;
        let active = true, pending = false;
        async function loadRequests() {
            if (pending) return;
            pending = true;
            const epoch = lifecycleEpoch.current;
            const reviewedAttempt = reviewRequested.current;
            try {
                const token = await withRequestDeadline(() => accountAccessToken(userId));
                if (!active || !canOperate() || lifecycleEpoch.current !== epoch) return;
                const [groupsResult, requestsResult] = await Promise.all([
                    withRequestDeadline(signal => supabase.from("groups").select("id").setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)),
                    withRequestDeadline(signal => supabase.from("join_requests").select("id,group_id,status,requested_at").eq("user_id", userId)
                        .order("requested_at", { ascending: false }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)),
                ]);
                if (groupsResult.error) throw groupsResult.error;
                if (requestsResult.error) throw requestsResult.error;
                if (active && canOperate() && lifecycleEpoch.current === epoch) {
                    setLoadError("");
                    setGroupIds(groupsResult.data.map(group => group.id));
                    setRequests(requestsResult.data);
                    if (reviewedAttempt && currentJoin.current.owns(reviewedAttempt)) setReviewed(reviewedAttempt);
                }
            } catch {
                if (active && canOperate() && lifecycleEpoch.current === epoch) {
                    setReviewed(null);
                    setRequests([]); setGroupIds([]);
                    setLoadError("Could not load your join requests. Check your connection and refresh.");
                }
            } finally {
                pending = false;
                if (active && lifecycleEpoch.current === epoch) setLoading(false);
            }
        }
        void loadRequests();
        const timer = setInterval(loadRequests, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [userId, focused, isActive, foregroundVersion, refreshVersion]);

    function returnToGroups() {
        if (!canOperate() || submitting.current) return;
        leave.requestLeave(() => router.dismissTo("/groups", { withAnchor: true }));
    }

    async function handleRequest() {
        if (!canOperate() || currentCode.current !== inviteCode || submitting.current || busy || locked || loading) return;
        setError(""); setRequestMessage("");
        if (inviteCode.trim() === "") {
            setError("Please enter an invite code.");
            return;
        }
        setRequesting(true); submitting.current = true;
        const epoch = lifecycleEpoch.current;
        let attempt: ReturnType<typeof join.begin> = null;
        let rejected = false;
        try {
            const token = await withRequestDeadline(() => accountAccessToken(userId));
            if (!canOperate() || lifecycleEpoch.current !== epoch) return;
            attempt = join.begin();
            if (!attempt) return;
            const result = await withRequestDeadline(signal => supabase.rpc("request_group_access", { invite_code: inviteCode.trim() })
                .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
            // A backgrounded, removed or superseded route cannot confirm an old
            // response. Preserve its account-scoped lock conservatively instead.
            if (!canOperate() || lifecycleEpoch.current !== epoch) { join.settle(attempt, true); return; }
            if (result.error) {
                rejected = result.status >= 400 && result.status < 500 && !!result.error.code;
                throw result.error;
            }
            if (!join.settle(attempt, false)) return;
            setInviteCode("");
            setRequestMessage("Request sent. The Owner must approve it before you can access the group.");
            setRefreshVersion(value => value + 1);
        } catch (error) {
            const current = !attempt || join.settle(attempt, !rejected);
            if (current && canOperate() && lifecycleEpoch.current === epoch) setError(attempt && !rejected
                ? "Your membership request may already have been received. Review your request statuses before trying again."
                : groupErrorMessage(error));
        } finally {
            submitting.current = false;
            if (mounted.current) setRequesting(false);
        }
    }

    return <ScreenScaffold edgeToEdge includeBottomInset onBack={returnToGroups} busy={busy}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        {leave.confirmation}
        {confirmRetry && <Modal visible transparent animationType="fade" onRequestClose={() => setConfirmRetry(null)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
                    <View accessibilityViewIsModal style={styles.card}>
                        <Text style={styles.cardTitle}>Another request could be a duplicate</Text>
                        <Text style={styles.message}>The earlier request may already have been received, or may still finish. A refreshed list cannot prove that it failed. Unlocking does not send anything; submit again only if you intend to make another request.</Text>
                        <Pressable accessibilityRole="button" onPress={() => setConfirmRetry(null)} style={styles.primaryButton}><Text style={styles.primaryText}>Keep Request Locked</Text></Pressable>
                        <Pressable accessibilityRole="button" onPress={() => {
                            if (!canOperate() || currentReview.current.reviewed !== confirmRetry || currentReview.current.confirmRetry !== confirmRetry || !join.acknowledge(confirmRetry)) return;
                            setConfirmRetry(null); setError(""); setRequestMessage("");
                        }} style={styles.secondaryButton}><Text style={styles.secondaryText}>I Understand — Unlock Request</Text></Pressable>
                    </View>
                </ScrollView>
            </View>
        </Modal>}
        <Text style={styles.title}>Join a Group</Text>
        {join.attempt && <Text accessibilityLiveRegion="polite" style={join.attempt.status === "uncertain" ? styles.error : styles.message}>{join.attempt.status === "uncertain"
            ? "A previous membership request may already have been received, or may still finish. Request Access is locked; no automatic retry will occur."
            : "A membership request is in progress. Another submission is locked."}</Text>}
        {join.attempt?.status === "uncertain" && <>
            <Pressable accessibilityRole="button" disabled={loading || busy} onPress={() => {
                if (!canOperate() || !join.attempt || !join.owns(join.attempt)) return;
                reviewRequested.current = join.attempt; setReviewed(null); setRefreshVersion(value => value + 1);
            }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Review Request Statuses</Text></Pressable>
            {reviewed === join.attempt && !loading && !loadError && <Pressable accessibilityRole="button" onPress={() => setConfirmRetry(join.attempt)} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Review Retry Risk</Text>
            </Pressable>}
        </>}
        <Text style={styles.message}>Enter an invite code to request access to a private group. The Owner must approve your request.</Text>
        <Text style={styles.label}>Invite code</Text>
        <TextInput accessibilityLabel="Invite code" value={inviteCode} onChangeText={setInviteCode}
            placeholder="Paste an invite code" placeholderTextColor="#79665E" autoCapitalize="none"
            autoCorrect={false} autoComplete="off" maxLength={64} editable={!busy && !locked} style={styles.input} />
        <Pressable accessibilityRole="button" disabled={loading || busy || locked} onPress={handleRequest}
            style={[styles.primaryButton, (loading || busy || locked) && styles.disabled]}>
            <Text style={styles.primaryText}>{busy ? "Sending request..." : "Request Access"}</Text>
        </Pressable>
        {requestMessage !== "" && <Text accessibilityLiveRegion="polite" style={styles.message}>{requestMessage}</Text>}
        {error !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={returnToGroups} style={[styles.secondaryButton, busy && styles.disabled]}>
            <Text style={styles.secondaryText}>{requestMessage ? "Return to Collections" : "Cancel"}</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.label}>Your join requests</Text>
        {loadError !== "" && <Text accessibilityLiveRegion="polite" style={styles.error}>{loadError}</Text>}
        {loading ? <Text style={styles.message}>Loading join requests...</Text> : !loadError && !requests.length
            ? <Text style={styles.message}>No join requests yet.</Text> : requests.map(request => {
                const currentMember = groupIds.includes(request.group_id);
                return <View key={request.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{request.status === "pending" ? "Pending approval" : request.status === "denied" ? "Denied" : currentMember ? "Approved" : "Previously approved"}</Text>
                    {request.status === "approved" && <Text style={styles.message}>{currentMember
                        ? "This group is available in Collections."
                        : "This past approval does not grant current access. To rejoin, request access with an active invite code."}</Text>}
                    <Text style={styles.message}>Requested {new Date(request.requested_at).toLocaleDateString()}</Text>
                </View>;
            })}
        <Pressable accessibilityRole="button" disabled={loading || busy} onPress={() => { if (canOperate() && !submitting.current) setRefreshVersion(value => value + 1); }}
            style={[styles.secondaryButton, (loading || busy) && styles.disabled]}>
            <Text style={styles.secondaryText}>Refresh Requests</Text>
        </Pressable>
    </ScreenScaffold>;
}
