import { backToContext, destinationHref, type DetailOrigin } from "@/lib/restaurant-navigation";
import { CollectionStats, RestaurantRow } from "@/components/collection-browse";
import { collectionStyles as s } from "@/styles/collections";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { GroupMembershipConfirmation, type MembershipAction } from "@/components/group-membership-confirmation";
import { useGroupAccess } from "@/hooks/use-group-access";
import { groupErrorMessage, isGroupAccessDenied } from "@/lib/group-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { accountAccessToken } from "@/lib/account-session";
import { backendStyles as styles } from "@/styles/backend";
import type { GroupMember, GroupMembershipTarget, GroupRestaurantSummary, PendingJoinRequest } from "@/types/database";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

export default function GroupDetailScreen({ origin = "collection" }: { origin?: DetailOrigin }) {
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id?: string | string[] }>();
    const { session, loading } = useAuth();
    const validId = typeof id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

    if (!loading && session && validId) {
        return <GroupDetails key={`${session.user.id}:${id}`} groupId={id} userId={session.user.id} origin={origin} />;
    }
    return (
        <ScreenScaffold edgeToEdge title="Group" onBack={() => backToContext(router, origin === "home" ? "/" : "/groups")}>
            <Text style={styles.message}>
                {loading ? "Restoring your session..." : !session ? "Sign in to view your groups." : "This group could not be found."}
            </Text>
        </ScreenScaffold>
    );
}

function GroupDetails({ groupId, userId, origin }: { groupId: string; userId: string; origin: DetailOrigin }) {
    const { fontScale } = useWindowDimensions();
    const router = useRouter();
    const [showSettings, setShowSettings] = useState(false);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [targets, setTargets] = useState<GroupMembershipTarget[]>([]);
    const [restaurants, setRestaurants] = useState<GroupRestaurantSummary[]>([]);
    const [requests, setRequests] = useState<PendingJoinRequest[]>([]);
    const [inviteExpires, setInviteExpires] = useState<string | null | undefined>();
    const [inviteCode, setInviteCode] = useState<{ value: string; membershipId: string } | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(true);
    const [loadedAccessKey, setLoadedAccessKey] = useState("");
    const [loadError, setLoadError] = useState("");
    const [confirmation, setConfirmation] = useState<MembershipAction | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const { access, loading: accessLoading, error: accessError } = useGroupAccess(groupId, userId, refreshVersion);
    const group = access?.group ?? null;
    const isOwner = group?.owner_user_id === userId;
    const accessKey = access ? `${access.membershipId}:${group?.owner_user_id}` : "";
    const loading = accessLoading || detailsLoading || (!!access && loadedAccessKey !== accessKey);
    const blocked = busy || loading || confirmation !== null;
    const rawCode = isOwner && inviteCode?.membershipId === access?.membershipId ? inviteCode?.value ?? "" : "";
    const mutation = useRef(false);
    const active = useRef(false);
    const screenEpoch = useRef(0);
    const scroll = useRef<ScrollView>(null);

    const clearDetails = useCallback(() => {
        setMembers([]);
        setTargets([]);
        setRestaurants([]);
        setRequests([]);
        setInviteExpires(undefined);
        setLoadedAccessKey("");
        setConfirmation(null);
    }, []);

    function refreshDetails() {
        clearDetails();
        setDetailsLoading(true);
        setRefreshVersion(value => value + 1);
    }

    // The usable code lives only in this screen's memory, never in local storage.
    useFocusEffect(useCallback(() => {
        active.current = true;
        screenEpoch.current++;
        setBusy(mutation.current);
        setInviteCode(null);
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") {
                screenEpoch.current++;
                setInviteCode(null);
                clearDetails();
            }
        });
        return () => {
            subscription.remove();
            active.current = false;
            screenEpoch.current++;
            setInviteCode(null);
            clearDetails();
        };
    }, [clearDetails]));

    useEffect(() => {
        clearDetails();
        setLoadError("");
        setDetailsLoading(!!access);
        if (!access) {
            if (!accessLoading) setInviteCode(null);
            return;
        }
        setInviteCode(previous => isOwner && previous?.membershipId === access.membershipId ? previous : null);
        let current = true;
        async function loadDetails() {
            try {
                const [membersResult, restaurantsResult] = await Promise.all([
                    supabase.rpc("get_group_members", { target_group_id: groupId }),
                    supabase.rpc("get_group_restaurants", { target_group_id: groupId }),
                ]);
                if (membersResult.error) throw membersResult.error;
                if (restaurantsResult.error) throw restaurantsResult.error;
                let ownerData: { inviteExpires: string | null | undefined; requests: PendingJoinRequest[]; targets: GroupMembershipTarget[] } | null = null;
                if (isOwner) {
                    const [inviteResult, requestsResult, targetsResult] = await Promise.all([
                        supabase.from("group_invites").select("expires_at").eq("group_id", groupId).is("revoked_at", null).maybeSingle(),
                        supabase.rpc("get_pending_join_requests", { target_group_id: groupId }),
                        supabase.rpc("get_group_membership_targets", { target_group_id: groupId }),
                    ]);
                    if (inviteResult.error) throw inviteResult.error;
                    if (requestsResult.error) throw requestsResult.error;
                    if (targetsResult.error) throw targetsResult.error;
                    ownerData = { inviteExpires: inviteResult.data?.expires_at, requests: requestsResult.data, targets: targetsResult.data };
                }
                if (current) {
                    setMembers(membersResult.data);
                    setRestaurants(restaurantsResult.data);
                    setInviteExpires(ownerData?.inviteExpires);
                    setRequests(ownerData?.requests ?? []);
                    setTargets(ownerData?.targets ?? []);
                }
            } catch (error) {
                if (current) {
                    clearDetails();
                    setInviteCode(null);
                    setLoadError("Could not load current group details. Check your connection and refresh.");
                    if (isGroupAccessDenied(error)) setRefreshVersion(value => value + 1);
                }
            } finally {
                if (current) {
                    setLoadedAccessKey(accessKey);
                    setDetailsLoading(false);
                }
            }
        }
        loadDetails();
        return () => { current = false; };
    }, [groupId, access, accessLoading, isOwner, accessKey, clearDetails]);

    function startMutation(confirmed = false) {
        if (!active.current || mutation.current || loading || !access || loadError || (!confirmed && confirmation)) return null;
        mutation.current = true;
        setBusy(true);
        setError("");
        setMessage("");
        return screenEpoch.current;
    }

    function isCurrent(epoch: number) {
        return active.current && screenEpoch.current === epoch;
    }

    function finishMutation() {
        mutation.current = false;
        if (active.current) setBusy(false);
    }

    function requestConfirmation(action: MembershipAction) {
        if (blocked || loadError) return;
        setError("");
        setMessage("");
        setConfirmation(action);
        scroll.current?.scrollTo({ y: 0, animated: true });
    }

    async function handleMembership() {
        if (!confirmation) return;
        const action = confirmation; // Keep the ID the user confirmed; never substitute a refreshed ID.
        const epoch = startMutation(true);
        if (epoch === null) return;
        if (action.kind === "transfer") setInviteCode(null);
        try {
            const token = await accountAccessToken(userId);
            if (!isCurrent(epoch)) return;
            const result = action.kind === "leave"
                ? await supabase.rpc("leave_group", { target_group_id: groupId, expected_membership_id: action.membershipId }).setHeader("Authorization", `Bearer ${token}`).retry(false)
                : await supabase.rpc(action.kind === "remove" ? "remove_group_member" : "transfer_group_ownership", {
                    target_group_id: groupId, target_user_id: action.target.user_id, expected_membership_id: action.target.membership_id,
                }).setHeader("Authorization", `Bearer ${token}`).retry(false);
            if (result.error) throw result.error;
            if (!isCurrent(epoch)) return;
            setConfirmation(null);
            clearDetails();
            if (action.kind === "leave") {
                setInviteCode(null);
                router.dismissTo("/groups");
            } else {
                setMessage(action.kind === "remove" ? "Member removed. Their visits remain saved." : "Ownership transferred. You are now a Member.");
                refreshDetails();
            }
        } catch (error) {
            if (isCurrent(epoch)) {
                setError(groupErrorMessage(error));
                setInviteCode(null);
                // Ambiguous results and stale IDs both require reviewing fresh state.
                // Do not automatically retry a removal with a newer admission ID.
                refreshDetails();
            }
        } finally {
            finishMutation();
        }
    }

    async function handleInvite(action: "generate" | "revoke") {
        const epoch = startMutation();
        if (epoch === null) return;
        try {
            const token = await accountAccessToken(userId);
            if (!isCurrent(epoch)) return;
            if (action === "generate") {
                const { data, error } = await supabase.rpc("generate_group_invite", { target_group_id: groupId }).setHeader("Authorization", `Bearer ${token}`).retry(false);
                if (error) throw error;
                if (!isCurrent(epoch)) return;
                setInviteCode({ value: data, membershipId: access!.membershipId });
                setMessage("New code generated. Any previous code is no longer valid.");
            } else {
                const { error } = await supabase.rpc("revoke_group_invite", { target_group_id: groupId }).setHeader("Authorization", `Bearer ${token}`).retry(false);
                if (error) throw error;
                if (!isCurrent(epoch)) return;
                setInviteCode(null);
                setMessage("Invite revoked. No new requests can use that code.");
            }
            refreshDetails();
        } catch (error) {
            if (isCurrent(epoch)) {
                setError(groupErrorMessage(error));
                if (isGroupAccessDenied(error)) { setInviteCode(null); refreshDetails(); }
            }
        } finally {
            finishMutation();
        }
    }

    async function handleDecision(requestId: string, decision: "approved" | "denied") {
        const epoch = startMutation();
        if (epoch === null) return;
        try {
            const token = await accountAccessToken(userId);
            if (!isCurrent(epoch)) return;
            const { error } = await supabase.rpc("decide_join_request", { target_request_id: requestId, decision }).setHeader("Authorization", `Bearer ${token}`).retry(false);
            if (error) throw error;
            if (isCurrent(epoch)) setMessage(decision === "approved" ? "Request approved. They are now a group member." : "Request denied.");
        } catch (error) {
            if (isCurrent(epoch)) setError(groupErrorMessage(error));
        } finally {
            if (isCurrent(epoch)) refreshDetails();
            finishMutation();
        }
    }

    async function handleCopyInvite() {
        if (rawCode === "" || blocked) return;
        const epoch = screenEpoch.current;
        setError("");
        setMessage("");
        try {
            const copied = await Clipboard.setStringAsync(rawCode);
            if (!copied) throw new Error("Clipboard unavailable");
            if (isCurrent(epoch)) setMessage("Invite code copied.");
        } catch {
            if (isCurrent(epoch)) setError("Could not copy the invite code. Try again or select and copy it manually.");
        }
    }

    const hasActiveInvite = inviteExpires !== undefined && (inviteExpires === null || new Date(inviteExpires).getTime() > Date.now());

    return (
        <ScreenScaffold key={fontScale} edgeToEdge title={group && !loading && !loadError ? undefined : "Group"} scrollRef={scroll} busy={busy} onBack={() => backToContext(router, origin === "home" ? "/" : "/groups")}>
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {accessError !== "" && <Text style={styles.error}>{accessError}</Text>}
            {loadError !== "" && <Text style={styles.error}>{loadError}</Text>}
            {message !== "" && message !== "Invite code copied." && <Text style={styles.message}>{message}</Text>}
            {loading ? <Text style={styles.message}>Loading group...</Text> : !group ? (
                <Text style={styles.message}>This group could not be found or you are no longer a member. Return to Collections or refresh.</Text>
            ) : loadError !== "" ? (
                <Text style={styles.message}>Refresh to load current group details before taking an action.</Text>
            ) : (
                <>
                    <Text style={s.eyebrow}>SHARED COLLECTION</Text>
                    <Text accessibilityRole="header" style={[s.title, fontScale > 1.5 && s.largeTitle]}>{group.name}</Text>
                    <View style={s.groupBanner}>
                        <Ionicons name="people-outline" size={26} color="#9B5639" accessible={false} />
                        <View style={s.body}><Text style={s.bannerTitle}>A table for your people</Text>
                            <Text style={s.bannerCaption}>{members.length} {members.length === 1 ? "member" : "members"} · You are {isOwner ? "the Owner" : "a Member"}</Text></View>
                    </View>
                    <CollectionStats restaurants={restaurants.length} visits={restaurants.reduce((sum, restaurant) => sum + restaurant.total_visit_count, 0)} />
                    {confirmation && <GroupMembershipConfirmation action={confirmation} busy={busy} onConfirm={handleMembership} onCancel={() => setConfirmation(null)} />}
                    <View style={s.section}>
                        <Text accessibilityRole="header" style={s.sectionTitle}>Saved restaurants</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel="Refresh Group" disabled={blocked}
                            onPress={() => { setError(""); setMessage(""); refreshDetails(); }} style={[s.refresh, blocked && styles.disabled]}>
                            <Ionicons name="refresh-outline" size={20} color="#C9472C" accessible={false} />
                        </Pressable>
                    </View>
                    {restaurants.length === 0 && <Text style={s.empty}>Your next meal belongs here. Use Add to share a visit with this group.</Text>}
                    {restaurants.length > 0 && <View style={s.surface}>{restaurants.map((restaurant, index) => (
                        <RestaurantRow key={restaurant.id} first={index === 0} restaurant={restaurant} disabled={blocked}
                            onPress={() => router.push(destinationHref({ destination_kind: "group", group_id: groupId, entry_id: restaurant.id, visit_id: null, available: true }, origin), { withAnchor: true })} />
                    ))}</View>}
                    <View style={s.settings}>
                        <Pressable accessibilityRole="button" accessibilityLabel="People & settings" accessibilityState={{ expanded: showSettings }}
                            disabled={busy} onPress={() => setShowSettings(value => !value)} style={s.settingsToggle}>
                            <Ionicons name="people-outline" size={20} color="#79665E" accessible={false} />
                            <View style={s.body}><Text style={s.name}>People & settings</Text><Text style={s.address}>{requests.length ? `${requests.length} pending ${requests.length === 1 ? "request" : "requests"} · ` : ""}{isOwner ? "Members, invites & ownership" : "Members & membership"}</Text></View>
                            <Ionicons name={showSettings ? "chevron-up" : "chevron-down"} size={18} color="#79665E" accessible={false} />
                        </Pressable>
                    </View>
                    {showSettings && <>
                        <Text style={styles.label}>Current members</Text>
                        {members.map(member => {
                            const target = targets.find(item => item.user_id === member.user_id);
                            return (
                                <View key={member.user_id} style={[s.rule, { paddingVertical: 16 }]}>
                                    <Text style={s.name}>{member.display_name}</Text>
                                    <Text style={styles.message}>{member.is_owner ? "Owner" : "Member"}</Text>
                                    {isOwner && !member.is_owner && target && (
                                        <>
                                            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${member.display_name} from group`} disabled={blocked} onPress={() => requestConfirmation({ kind: "remove", groupName: group.name, target })} style={[styles.secondaryButton, blocked && styles.disabled]}>
                                                <Text style={styles.secondaryText}>Remove Member</Text>
                                            </Pressable>
                                            <Pressable accessibilityRole="button" accessibilityLabel={`Transfer ownership to ${member.display_name}`} disabled={blocked} onPress={() => requestConfirmation({ kind: "transfer", groupName: group.name, target })} style={[styles.secondaryButton, blocked && styles.disabled]}>
                                                <Text style={styles.secondaryText}>Transfer Ownership</Text>
                                            </Pressable>
                                        </>
                                    )}
                                </View>
                            );
                        })}
                        <Text style={styles.label}>Membership</Text>
                        {isOwner && <Text style={styles.message}>{members.length === 1 ? "You are the sole Owner. Approve another Member before transferring ownership and leaving." : "Transfer ownership to another current Member before leaving. You will stay a Member after the transfer."}</Text>}
                        <Pressable accessibilityRole="button" disabled={isOwner || blocked} onPress={() => access && requestConfirmation({ kind: "leave", groupName: group.name, membershipId: access.membershipId })} style={[styles.secondaryButton, (isOwner || blocked) && styles.disabled]}>
                            <Text style={styles.secondaryText}>Leave Group</Text>
                        </Pressable>
                        {isOwner && (
                            <>
                                <Text style={styles.label}>Invite code</Text>
                                <Text style={styles.message}>
                                    {hasActiveInvite ? "An invite is active. Resetting it invalidates the previous code." : "No active invite. Generate a code to invite someone."}
                                </Text>
                                <Pressable accessibilityRole="button" disabled={blocked} onPress={() => handleInvite("generate")} style={[styles.primaryButton, blocked && styles.disabled]}>
                                    <Text style={styles.primaryText}>Generate / Reset Invite Code</Text>
                                </Pressable>
                                {rawCode !== "" && (
                                    <View style={styles.card}>
                                        <Text selectable style={styles.cardTitle}>{rawCode}</Text>
                                        <Pressable accessibilityRole="button" disabled={blocked} onPress={handleCopyInvite} style={[styles.secondaryButton, blocked && styles.disabled]}>
                                            <Text style={styles.secondaryText}>Copy Invite Code</Text>
                                        </Pressable>
                                        {message === "Invite code copied." && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
                                        <Text style={styles.message}>Select and copy this code. It expires after 7 days. It cannot be retrieved after leaving this screen.</Text>
                                    </View>
                                )}
                                <Pressable accessibilityRole="button" disabled={blocked || !hasActiveInvite} onPress={() => handleInvite("revoke")} style={[styles.secondaryButton, (blocked || !hasActiveInvite) && styles.disabled]}>
                                    <Text style={styles.secondaryText}>Revoke Invite</Text>
                                </Pressable>
                                <Text style={styles.label}>Pending join requests</Text>
                                {requests.length === 0 && <Text style={styles.message}>No pending requests.</Text>}
                                {requests.map(request => (
                                    <View key={request.id} style={styles.card}>
                                        <Text style={styles.cardTitle}>{request.display_name}</Text>
                                        <Text style={styles.message}>Requested {new Date(request.requested_at).toLocaleDateString()}</Text>
                                        <Pressable accessibilityRole="button" accessibilityLabel={`Approve ${request.display_name}`} disabled={blocked} onPress={() => handleDecision(request.id, "approved")} style={styles.primaryButton}>
                                            <Text style={styles.primaryText}>Approve</Text>
                                        </Pressable>
                                        <Pressable accessibilityRole="button" accessibilityLabel={`Deny ${request.display_name}`} disabled={blocked} onPress={() => handleDecision(request.id, "denied")} style={styles.secondaryButton}>
                                            <Text style={styles.secondaryText}>Deny</Text>
                                        </Pressable>
                                    </View>
                                ))}
                            </>
                        )}
                    </>}
                </>
            )}
            {(loading || !group || !!loadError) && <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => { setError(""); setMessage(""); refreshDetails(); }} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Refresh Group</Text>
            </Pressable>}
        </ScreenScaffold>
    );
}
