import { groupErrorMessage } from "@/lib/group-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { Group, GroupMember, PendingJoinRequest } from "@/types/database";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

export default function GroupDetailScreen() {
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    const { session, loading } = useAuth();
    const validId = typeof id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

    if (!loading && session && validId) {
        return <GroupDetails key={`${session.user.id}:${id}`} groupId={id} userId={session.user.id} />;
    }
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" onPress={() => router.dismissTo("/groups")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>Group</Text>
            <Text style={styles.message}>
                {loading ? "Restoring your session..." : !session ? "Sign in to view your groups." : "This group could not be found."}
            </Text>
        </ScrollView>
    );
}

function GroupDetails({ groupId, userId }: { groupId: string; userId: string }) {
    const router = useRouter();
    const [group, setGroup] = useState<Group | null>(null);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [requests, setRequests] = useState<PendingJoinRequest[]>([]);
    const [inviteExpires, setInviteExpires] = useState<string | null | undefined>();
    const [rawCode, setRawCode] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const isFocused = useIsFocused();

    // The usable code lives only in this screen's memory, never in local storage.
    useFocusEffect(useCallback(() => {
        setRawCode("");
        return () => { setRawCode(""); };
    }, []));

    useEffect(() => {
        if (!isFocused) return;
        let active = true;
        async function loadDetails() {
            setLoading(true);
            try {
                const result = await supabase.from("groups").select("*").eq("id", groupId).maybeSingle();
                if (result.error) throw result.error;
                if (!active) return;
                setGroup(result.data);
                if (result.data) {
                    const membersResult = await supabase.rpc("get_group_members", { target_group_id: groupId });
                    if (membersResult.error) throw membersResult.error;
                    if (!active) return;
                    setMembers(membersResult.data);
                } else {
                    setMembers([]);
                }
                if (result.data?.owner_user_id === userId) {
                    const [inviteResult, requestsResult] = await Promise.all([
                        supabase.from("group_invites").select("expires_at").eq("group_id", groupId).is("revoked_at", null).maybeSingle(),
                        supabase.rpc("get_pending_join_requests", { target_group_id: groupId }),
                    ]);
                    if (inviteResult.error) throw inviteResult.error;
                    if (requestsResult.error) throw requestsResult.error;
                    if (active) {
                        setInviteExpires(inviteResult.data ? inviteResult.data.expires_at : undefined);
                        setRequests(requestsResult.data);
                    }
                }
            } catch {
                if (active) setError("Could not load this group. Check your connection and refresh.");
            } finally {
                if (active) setLoading(false);
            }
        }
        loadDetails();
        return () => { active = false; };
    }, [groupId, userId, isFocused, refreshVersion]);

    async function handleInvite(action: "generate" | "revoke") {
        if (busy || loading) return;
        setBusy(true);
        setError("");
        setMessage("");
        try {
            if (action === "generate") {
                const { data, error } = await supabase.rpc("generate_group_invite", { target_group_id: groupId });
                if (error) throw error;
                setRawCode(data);
                setMessage("New code generated. Any previous code is no longer valid.");
            } else {
                const { error } = await supabase.rpc("revoke_group_invite", { target_group_id: groupId });
                if (error) throw error;
                setRawCode("");
                setMessage("Invite revoked. No new requests can use that code.");
            }
            setRefreshVersion(value => value + 1);
        } catch (error) {
            setError(groupErrorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    async function handleDecision(requestId: string, decision: "approved" | "denied") {
        if (busy || loading) return;
        setBusy(true);
        setError("");
        setMessage("");
        try {
            const { error } = await supabase.rpc("decide_join_request", { target_request_id: requestId, decision });
            if (error) throw error;
            setMessage(decision === "approved" ? "Request approved. They are now a group member." : "Request denied.");
        } catch (error) {
            setError(groupErrorMessage(error));
        } finally {
            setRefreshVersion(value => value + 1);
            setBusy(false);
        }
    }

    async function handleCopyInvite() {
        if (rawCode === "" || busy || loading) return;
        setError("");
        setMessage("");
        try {
            const copied = await Clipboard.setStringAsync(rawCode);
            if (!copied) throw new Error("Clipboard unavailable");
            setMessage("Invite code copied.");
        } catch {
            setError("Could not copy the invite code. Try again or select and copy it manually.");
        }
    }

    const isOwner = group?.owner_user_id === userId;
    const hasActiveInvite = inviteExpires !== undefined && (inviteExpires === null || new Date(inviteExpires).getTime() > Date.now());

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.dismissTo("/groups")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>{group?.name ?? "Group"}</Text>
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {message !== "" && message !== "Invite code copied." && <Text style={styles.message}>{message}</Text>}
            {loading ? <Text style={styles.message}>Loading group...</Text> : !group ? (
                <Text style={styles.message}>This group could not be found or you do not have access.</Text>
            ) : (
                <>
                    <Text style={styles.message}>{isOwner ? "You are the Owner." : "You are a Member."}</Text>
                    <Text style={styles.label}>Current members</Text>
                    {members.map(member => (
                        <View key={member.user_id} style={styles.card}>
                            <Text style={styles.cardTitle}>{member.display_name}</Text>
                            <Text style={styles.message}>{member.is_owner ? "Owner" : "Member"}</Text>
                        </View>
                    ))}
                    {isOwner && (
                        <>
                            <Text style={styles.label}>Invite code</Text>
                            <Text style={styles.message}>
                                {hasActiveInvite ? "An invite is active. Resetting it invalidates the previous code." : "No active invite. Generate a code to invite someone."}
                            </Text>
                            <Pressable accessibilityRole="button" disabled={busy} onPress={() => handleInvite("generate")} style={[styles.primaryButton, busy && styles.disabled]}>
                                <Text style={styles.primaryText}>Generate / Reset Invite Code</Text>
                            </Pressable>
                            {rawCode !== "" && (
                                <View style={styles.card}>
                                    <Text selectable style={styles.cardTitle}>{rawCode}</Text>
                                    <Pressable accessibilityRole="button" disabled={busy} onPress={handleCopyInvite} style={[styles.secondaryButton, busy && styles.disabled]}>
                                        <Text style={styles.secondaryText}>Copy Invite Code</Text>
                                    </Pressable>
                                    {message === "Invite code copied." && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
                                    <Text style={styles.message}>Select and copy this code. It expires after 7 days. It cannot be retrieved after leaving this screen.</Text>
                                </View>
                            )}
                            <Pressable accessibilityRole="button" disabled={busy || !hasActiveInvite} onPress={() => handleInvite("revoke")} style={[styles.secondaryButton, (busy || !hasActiveInvite) && styles.disabled]}>
                                <Text style={styles.secondaryText}>Revoke Invite</Text>
                            </Pressable>
                            <Text style={styles.label}>Pending join requests</Text>
                            {requests.length === 0 && <Text style={styles.message}>No pending requests.</Text>}
                            {requests.map(request => (
                                <View key={request.id} style={styles.card}>
                                    <Text style={styles.cardTitle}>{request.display_name}</Text>
                                    <Text style={styles.message}>Requested {new Date(request.requested_at).toLocaleDateString()}</Text>
                                    <Pressable accessibilityRole="button" accessibilityLabel={`Approve ${request.display_name}`} disabled={busy} onPress={() => handleDecision(request.id, "approved")} style={styles.primaryButton}>
                                        <Text style={styles.primaryText}>Approve</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel={`Deny ${request.display_name}`} disabled={busy} onPress={() => handleDecision(request.id, "denied")} style={styles.secondaryButton}>
                                        <Text style={styles.secondaryText}>Deny</Text>
                                    </Pressable>
                                </View>
                            ))}
                        </>
                    )}
                </>
            )}
            <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => { setError(""); setRefreshVersion(value => value + 1); }} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Refresh Group</Text>
            </Pressable>
        </ScrollView>
    );
}
