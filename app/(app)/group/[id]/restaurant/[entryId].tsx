import { VisitManagement } from "@/components/visit-management";
import { useGroupAccess } from "@/hooks/use-group-access";
import { isGroupAccessDenied } from "@/lib/group-errors";
import { isUuid, visitSummary } from "@/lib/restaurant-ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { GroupRestaurantSummary, GroupVisit } from "@/types/database";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

export default function GroupRestaurantScreen() {
    const router = useRouter();
    const { id, entryId } = useLocalSearchParams<{ id?: string | string[]; entryId?: string | string[] }>();
    const { session, loading } = useAuth();
    if (!loading && session && isUuid(id) && isUuid(entryId)) {
        return <RestaurantDetails key={`${session.user.id}:${id}:${entryId}`} groupId={id} entryId={entryId} userId={session.user.id} />;
    }
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" onPress={() => router.dismissTo("/groups")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>Restaurant</Text>
            <Text style={styles.message}>{loading ? "Restoring your session..." : !session ? "Sign in to view group visits." : "This restaurant could not be found."}</Text>
        </ScrollView>
    );
}

function RestaurantDetails({ groupId, entryId, userId }: { groupId: string; entryId: string; userId: string }) {
    const router = useRouter();
    const [restaurant, setRestaurant] = useState<GroupRestaurantSummary | null>(null);
    const [visits, setVisits] = useState<GroupVisit[]>([]);
    const [detailsLoading, setDetailsLoading] = useState(true);
    const [loadedAccessKey, setLoadedAccessKey] = useState("");
    const [error, setError] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [management, setManagement] = useState<{ visitId: string; action: "edit" | "delete" } | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const { access, loading: accessLoading, error: accessError } = useGroupAccess(groupId, userId, refreshVersion);
    const accessKey = access ? `${access.membershipId}:${access.group.owner_user_id}` : "";
    const loading = accessLoading || detailsLoading || (!!access && loadedAccessKey !== accessKey);
    const visibleRestaurant = access && loadedAccessKey === accessKey ? restaurant : null;

    function refreshAccess() {
        setRestaurant(null);
        setVisits([]);
        setManagement(null);
        setBusy(false);
        setRefreshVersion(value => value + 1);
    }

    useEffect(() => {
        setRestaurant(null);
        setVisits([]);
        setManagement(null);
        setBusy(false);
        setLoadedAccessKey("");
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
                    setLoadedAccessKey(accessKey);
                    setDetailsLoading(false);
                }
            }
        }
        loadDetails();
        return () => { active = false; };
    }, [groupId, entryId, access, accessKey]);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.dismissTo({ pathname: "/group/[id]", params: { id: groupId } })} style={[styles.secondaryButton, styles.backButton, busy && styles.disabled]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>{visibleRestaurant?.name ?? "Restaurant"}</Text>
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
                    <Text style={styles.label}>This group&apos;s visits</Text>
                    {visits.length === 0 && <Text style={styles.message}>No visits yet.</Text>}
                    {visits.map(visit => (
                        <View key={visit.id} style={styles.card}>
                            <Text style={styles.cardTitle}>Added by {visit.creator_display_name}</Text>
                            {visit.visited_on !== null && <Text style={styles.message}>Date: {visit.visited_on}</Text>}
                            {visit.rating !== null && <Text style={styles.message}>Rating: {visit.rating}/5</Text>}
                            {visit.would_go_again !== null && <Text style={styles.message}>Would go again: {visit.would_go_again ? "Yes" : "No"}</Text>}
                            {visit.notes && <Text style={styles.message}>{visit.notes}</Text>}
                            {management?.visitId === visit.id ? (
                                <VisitManagement
                                    key={`${visit.id}:${management.action}`}
                                    visit={visit}
                                    scope={{ target_group_id: groupId, target_group_restaurant_id: entryId, target_visit_id: visit.id }}
                                    action={management.action}
                                    onCancel={() => setManagement(null)}
                                    onBusyChange={setBusy}
                                    onAccessDenied={() => {
                                        setMessage("Your access or Visit permissions changed. Review the refreshed group before continuing.");
                                        refreshAccess();
                                    }}
                                    onComplete={entryRemoved => {
                                        const action = management.action;
                                        setManagement(null);
                                        if (entryRemoved) {
                                            router.dismissTo({ pathname: "/group/[id]", params: { id: groupId } });
                                        } else {
                                            setMessage(action === "edit" ? "Visit updated." : "Visit deleted.");
                                            refreshAccess();
                                        }
                                    }}
                                />
                            ) : visit.can_manage && (
                                <>
                                    <Pressable accessibilityRole="button" accessibilityLabel={`Edit visit by ${visit.creator_display_name}`} disabled={management !== null} onPress={() => { setMessage(""); setManagement({ visitId: visit.id, action: "edit" }); }} style={[styles.secondaryButton, management !== null && styles.disabled]}>
                                        <Text style={styles.secondaryText}>Edit Visit</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel={`Delete visit by ${visit.creator_display_name}`} disabled={management !== null} onPress={() => { setMessage(""); setManagement({ visitId: visit.id, action: "delete" }); }} style={[styles.secondaryButton, management !== null && styles.disabled]}>
                                        <Text style={styles.secondaryText}>Delete Visit</Text>
                                    </Pressable>
                                </>
                            )}
                        </View>
                    ))}
                </>
            )}
            <Pressable accessibilityRole="button" disabled={loading || management !== null} onPress={() => { setMessage(""); refreshAccess(); }} style={[styles.secondaryButton, (loading || management !== null) && styles.disabled]}>
                <Text style={styles.secondaryText}>Refresh Restaurant</Text>
            </Pressable>
        </ScrollView>
    );
}
