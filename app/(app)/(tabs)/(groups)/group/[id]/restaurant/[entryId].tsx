import { ScreenScaffold } from "@/components/screen-scaffold";
import GroupApplePlaceLookup from "@/components/group-apple-place-lookup";
import { useVisitManagement } from "@/components/visit-management";
import { useGroupAccess } from "@/hooks/use-group-access";
import { isGroupAccessDenied } from "@/lib/group-errors";
import { isUuid, visitSummary } from "@/lib/restaurant-ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { GroupRestaurantSummary, GroupVisit } from "@/types/database";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function GroupRestaurantScreen({ fromAdd = false, fromMap = false }: { fromAdd?: boolean; fromMap?: boolean }) {
    const router = useRouter();
    const { id, entryId } = useLocalSearchParams<{ id?: string | string[]; entryId?: string | string[] }>();
    const { session, loading } = useAuth();
    if (!loading && session && isUuid(id) && isUuid(entryId)) {
        return <RestaurantDetails key={`${session.user.id}:${id}:${entryId}`} groupId={id} entryId={entryId} userId={session.user.id} fromAdd={fromAdd} fromMap={fromMap} />;
    }
    return (
        <ScreenScaffold edgeToEdge title="Restaurant" keyboardShouldPersistTaps="handled" onBack={() => fromAdd || fromMap ? (router.canGoBack() ? router.back() : router.replace(fromMap ? "/saved-map" : "/add")) : router.dismissTo("/groups")}>
            <Text style={styles.message}>{loading ? "Restoring your session..." : !session ? "Sign in to view group visits." : "This restaurant could not be found."}</Text>
        </ScreenScaffold>
    );
}

function RestaurantDetails({ groupId, entryId, userId, fromAdd, fromMap }: { groupId: string; entryId: string; userId: string; fromAdd: boolean; fromMap: boolean }) {
    const router = useRouter();
    const back = () => fromAdd || fromMap ? (router.canGoBack() ? router.back() : router.replace(fromMap ? "/saved-map" : "/add")) : router.dismissTo({ pathname: "/group/[id]", params: { id: groupId } });
    const [restaurant, setRestaurant] = useState<GroupRestaurantSummary | null>(null);
    const [visits, setVisits] = useState<GroupVisit[]>([]);
    const [detailsLoading, setDetailsLoading] = useState(true);
    const [loadedAccessKey, setLoadedAccessKey] = useState("");
    const [error, setError] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [management, setManagement] = useState<{ visit: GroupVisit; action: "edit" | "delete"; accessKey: string; identity: number } | null>(null);
    const nextEditor = useRef(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const { access, loading: accessLoading, error: accessError, revoked } = useGroupAccess(groupId, userId, refreshVersion);
    const loadedAccess = useRef<typeof access>(null);
    const accessKey = access ? `${access.membershipId}:${access.group.owner_user_id}` : "";
    const loading = accessLoading || detailsLoading || (!!access && (loadedAccessKey !== accessKey || loadedAccess.current !== access));
    const visibleRestaurant = access && !loading && loadedAccessKey === accessKey ? restaurant : null;
    const sameMembership = !!management && !revoked && (!access || management.accessKey === accessKey);
    const editor = useVisitManagement(sameMembership ? {
        visit: management.visit, action: management.action, identity: management.identity,
        scope: { target_group_id: groupId, target_group_restaurant_id: entryId, target_visit_id: management.visit.id },
        onCancel: () => setManagement(null), onBusyChange: setBusy,
        onAccessDenied: () => {
            setManagement(null);
            setMessage("Your access or Visit permissions changed. Review the refreshed group before continuing.");
            refreshAccess();
        },
        onComplete: entryRemoved => {
            setManagement(null);
            if (entryRemoved) back();
            else { setMessage(management.action === "edit" ? "Visit updated." : "Visit deleted."); refreshAccess(); }
        },
    } : null, {
        visible: !!access && !loading && !error && loadedAccessKey === accessKey,
        canMutate: !!visibleRestaurant && !!visits.find(visit => visit.id === management?.visit.id)?.can_manage,
    });

    useEffect(() => {
        if (management && !sameMembership) { setManagement(null); setBusy(false); }
    }, [management, sameMembership]);

    function refreshAccess() {
        setRestaurant(null);
        setVisits([]);
        setRefreshVersion(value => value + 1);
    }

    useEffect(() => {
        setRestaurant(null);
        setVisits([]);
        // The editor controller survives temporary access hiding and read failures.
        setLoadedAccessKey("");
        loadedAccess.current = null;
        setDetailsLoading(!!access);
        if (!access) return;
        let active = true;
        async function loadDetails() {
            setError("");
            try {
                const summaries = await supabase.rpc("get_group_restaurants", { target_group_id: groupId });
                if (summaries.error) throw summaries.error;
                const selected = summaries.data.find(item => item.id === entryId);
                if (!selected || !active) return;
                // Validate the entry belongs to this route's group before loading its memories.
                const result = await supabase.rpc("get_group_restaurant_visits", { target_group_restaurant_id: entryId });
                if (result.error) throw result.error;
                if (active) {
                    setRestaurant(selected);
                    setVisits(result.data);
                }
            } catch (error) {
                if (active) {
                    setError("Could not load this restaurant, or you do not have access. Check your connection and refresh.");
                    if (isGroupAccessDenied(error)) setRefreshVersion(value => value + 1);
                }
            } finally {
                if (active) {
                    loadedAccess.current = access;
                    setLoadedAccessKey(accessKey);
                    setDetailsLoading(false);
                }
            }
        }
        loadDetails();
        return () => { active = false; };
    }, [groupId, entryId, access, accessKey]);

    return (
        <ScreenScaffold edgeToEdge title={visibleRestaurant?.name ?? "Restaurant"} keyboardShouldPersistTaps="handled" busy={busy} onBack={back}>
            {editor.confirmation}
            {access && !accessLoading && <Text style={styles.contextLabel}>Group · {access.group.name}</Text>}
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {accessError !== "" && <Text style={styles.error}>{accessError}</Text>}
            {message !== "" && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
            {loading ? <Text style={styles.message}>Loading restaurant and visits...</Text> : !visibleRestaurant ? (
                <Text style={styles.message}>This restaurant could not be found or you do not have access.</Text>
            ) : (
                <>
                    <Text style={styles.message}>{visibleRestaurant.address}</Text>
                    {visibleRestaurant.cuisine && <Text style={styles.message}>{visibleRestaurant.cuisine}</Text>}
                    <Text style={styles.message}>{visitSummary(visibleRestaurant)}</Text>
                    <Pressable accessibilityRole="button" disabled={management !== null} onPress={() => router.push({ pathname: "/add-visit", params: { groupId, restaurantId: visibleRestaurant.restaurant_id } })} style={[styles.primaryButton, management !== null && styles.disabled]}>
                        <Text style={styles.primaryText}>Add Another Visit</Text>
                    </Pressable>
                    {__DEV__ && <GroupApplePlaceLookup key={`${userId}:${groupId}:${entryId}:${accessKey}`}
                        userId={userId} groupId={groupId} entryId={entryId} disabled={management !== null || busy} />}
                    <Text style={styles.label}>This group&apos;s visits</Text>
                    {visits.length === 0 && <Text style={styles.message}>No visits yet.</Text>}
                    {visits.map(visit => (
                        <View key={visit.id} style={styles.card}>
                            <View style={styles.cardBody}>
                                <Text style={styles.cardTitle}>Added by {visit.creator_display_name}</Text>
                                {visit.visited_on !== null && <Text style={[styles.message, styles.cardMessage]}>Date: {visit.visited_on}</Text>}
                                {visit.rating !== null && <Text style={[styles.message, styles.cardMessage]}>Rating: {visit.rating}/5</Text>}
                                {visit.would_go_again !== null && <Text style={[styles.message, styles.cardMessage]}>Would go again: {visit.would_go_again ? "Yes" : "No"}</Text>}
                                {visit.notes && <Text style={[styles.message, styles.cardMessage]}>{visit.notes}</Text>}
                            </View>
                            {management?.visit.id === visit.id ? (
                                <View style={styles.cardActions}>
                                    {editor.editor}
                                </View>
                            ) : visit.can_manage && (
                                <View style={styles.cardActions}>
                                    <Pressable accessibilityRole="button" accessibilityLabel={`Edit visit by ${visit.creator_display_name}`} disabled={management !== null} onPress={() => { setMessage(""); setManagement({ visit, action: "edit", accessKey, identity: ++nextEditor.current }); }} style={[styles.secondaryButton, styles.cardAction, management !== null && styles.disabled]}>
                                        <Text style={styles.secondaryText}>Edit Visit</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel={`Delete visit by ${visit.creator_display_name}`} disabled={management !== null} onPress={() => { setMessage(""); setManagement({ visit, action: "delete", accessKey, identity: ++nextEditor.current }); }} style={[styles.secondaryButton, styles.cardAction, management !== null && styles.disabled]}>
                                        <Text style={styles.secondaryText}>Delete Visit</Text>
                                    </Pressable>
                                </View>
                            )}
                        </View>
                    ))}
                </>
            )}
            {sameMembership && !visits.some(visit => visit.id === management?.visit.id) && editor.editor}
            <Pressable accessibilityRole="button" disabled={loading || busy} onPress={() => { setMessage(""); refreshAccess(); }} style={[styles.secondaryButton, (loading || busy) && styles.disabled]}>
                <Text style={styles.secondaryText}>Refresh Restaurant</Text>
            </Pressable>
        </ScreenScaffold>
    );
}
