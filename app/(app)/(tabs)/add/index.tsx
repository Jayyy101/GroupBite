import { AddResults, PreviousAddResults } from "@/components/add-results";
import { PhotoRecovery } from "@/components/visit-photos";
import { usePhotoJobs } from "@/providers/visit-photos";
import { PersonalAccess } from "@/components/personal-access";
import { RestaurantSearch } from "@/components/restaurant-search";
import { ScreenScaffold } from "@/components/screen-scaffold";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { accountAccessToken } from "@/lib/account-session";
import { recentRestaurantChoices } from "@/lib/recent-restaurants";
import { traceSearch } from "@/lib/search-diagnostics";
import { destinationHref } from "@/lib/restaurant-navigation";
import { isConfirmedAdd } from "@/lib/unified-add";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { useUnifiedAdd } from "@/providers/unified-add";
import { backendStyles as styles } from "@/styles/backend";
import type { AddRestaurant } from "@/types/database";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function AddScreen() {
    const { session } = useAuth();
    return session ? <AddLanding key={session.user.id} userId={session.user.id} /> : <PersonalAccess title="Add">{() => null}</PersonalAccess>;
}
function AddLanding({ userId }: { userId: string }) {
    const router = useRouter(), { coordinator, state } = useUnifiedAdd();
    const photoJobs = usePhotoJobs();
    const { session, loading: authLoading } = useAuth();
    const focused = useIsFocused(), { isActive, version } = useForegroundRefresh();
    const alive = useRef(false), active = useRef(false);
    const choosing = useRef(false);
    const dismissSuggestions = useRef<(() => void) | null>(null);
    active.current = focused && isActive && !authLoading && session?.user.id === userId;
    const [recent, setRecent] = useState<AddRestaurant[]>([]), [error, setError] = useState("");
    const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
    const [recentWidth, setRecentWidth] = useState(0);
    const canOperate = () => alive.current && active.current && AppState.currentState === "active";
    const groupRecovery = state.attempts.some(attempt => attempt.destination.kind === "group")
        || state.previous.some(previous => previous.attempts.some(attempt => attempt.destination.kind === "group"));
    const unresolved = !!state.error || state.attempts.some(a => a.status !== "saved");
    const leave = useLeaveGuard({ userId, dirty: false, busy: state.busy || !!photoJobs?.busy, uncertain: unresolved,
        uncertainExitMessage: "Some destinations may already have saved. Finishing does not undo them. Review every destination before starting a separate save. Leaving this screen keeps recovery available in Add." });
    useEffect(() => {
        traceSearch("landing:state", { focused, active: isActive, ready: state.ready, busy: state.busy, attempts: state.attempts.length, error: !!state.error });
    }, [focused, isActive, state.ready, state.busy, state.attempts.length, state.error]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => { choosing.current = false; }, [focused, isActive]);
    useEffect(() => {
        setRecent([]); setLoading(true); setError("");
        if (!focused || !isActive || state.attempts.length) return;
        let valid = true;
        void (async () => {
            try {
                const token = await accountAccessToken(userId);
                if (!valid || !canOperate()) return;
                const response = await withRequestDeadline(signal => supabase.rpc(__DEV__ ? "get_recent_add_restaurants_with_mapkit" : "get_recent_add_restaurants", { page_size: 12, page_offset: 0 })
                    .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
                if (response.error) throw response.error;
                if (valid && canOperate()) setRecent(recentRestaurantChoices(response.data));
            } catch { if (valid) setError("Could not load recent restaurants. Refresh or use search or manual entry."); }
            finally { if (valid) setLoading(false); }
        })();
        return () => { valid = false; };
        // canOperate reads refs; lifecycle changes reset this scoped read.
    }, [userId, focused, isActive, version, refresh, state.attempts.length]);
    useEffect(() => {
        if (!focused || !isActive || !groupRecovery) return;
        let valid = true;
        void (async () => {
            try {
                const token = await accountAccessToken(userId);
                const result = await withRequestDeadline(signal => supabase.from("groups").select("id,name")
                    .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
                if (valid && canOperate() && !result.error) coordinator.labelDestinations(result.data);
            } catch { /* Historical recovery remains available without group reads. */ }
        })();
        return () => { valid = false; };
    }, [userId, focused, isActive, version, state.attempts.length, state.previous.length, groupRecovery, coordinator]);
    function choose(restaurant: AddRestaurant | null) {
        if (!canOperate() || choosing.current || photoJobs?.busy || !coordinator.state.ready || coordinator.state.busy || coordinator.state.attempts.length || coordinator.state.error) return;
        choosing.current = true;
        coordinator.selectRestaurant(restaurant); router.push("/add-visit");
    }
    return <PersonalAccess title="Add">{() => <ScreenScaffold keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
        onTouchStart={() => dismissSuggestions.current?.()}>
        {leave.confirmation}
        <PhotoRecovery canOperate={canOperate} />
        {!state.ready ? <Text style={styles.message}>Checking save recovery...</Text> : state.attempts.length || state.error ? <AddResults canOperate={canOperate}
            separate={async (expected, temporary) => {
                const result = await coordinator.startSeparate(expected, canOperate, temporary);
                if (result === "started" && canOperate()) { choosing.current = false; leave.finish(() => router.dismissTo("/add")); }
                return result;
            }}
            open={result => {
                if (choosing.current) return;
                choosing.current = true;
                leave.finish(() => router.push(destinationHref(result, "add")));
            }}
            done={async () => {
                if (!canOperate()) return;
                if (isConfirmedAdd(coordinator.state)) {
                    if (await coordinator.clearConfirmed() && canOperate()) leave.finish(() => router.dismissTo("/add"));
                } else leave.requestLeave(() => router.navigate("/"));
            }} /> : <>
            <Text style={styles.title}>Save a restaurant</Text>
            <Text style={styles.message}>Choose a restaurant to start adding a visit.</Text>
            <RestaurantSearch onSelect={choose} searchLabel="Search" primarySearch connectedAutocomplete dismissSuggestionsRef={dismissSuggestions}>
                <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => { dismissSuggestions.current?.(); choose(null); }}>
                    <Text style={styles.secondaryText}>Enter Restaurant Manually</Text></Pressable>
            </RestaurantSearch>
            <View style={landingStyles.sectionHeading}>
                <Text accessibilityRole="header" style={[styles.label, styles.cardHeadingText, { marginBottom: 0 }]}>Recently saved restaurants</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Refresh Recent Restaurants" accessibilityState={{ disabled: loading }}
                    disabled={loading} style={[landingStyles.refresh, loading && styles.disabled]} onPress={() => { if (canOperate()) setRefresh(v => v + 1); }}>
                    <Ionicons name="refresh-outline" size={22} color="#C9472C" accessible={false} importantForAccessibility="no" />
                </Pressable>
            </View>
            <Text style={styles.message}>Swipe to browse · Tap to add another visit</Text>
            {loading ? <Text style={styles.message}>Loading recent restaurants...</Text> : error ? <Text style={styles.error}>{error}</Text> : !recent.length
                ? <Text style={styles.message}>No saved restaurants yet.</Text> : <ScrollView horizontal
                    showsHorizontalScrollIndicator={false} directionalLockEnabled nestedScrollEnabled
                    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
                    style={landingStyles.recentList} contentContainerStyle={landingStyles.recentContent}
                    onLayout={event => setRecentWidth(event.nativeEvent.layout.width)}>
                    {recent.map((restaurant, index) => <Pressable key={`${restaurant.entry_id}:${index}`}
                        accessibilityRole="button" accessibilityLabel={`${restaurant.name}, ${restaurant.address}`}
                        accessibilityHint="Start another visit, then choose where to save it."
                        style={[styles.card, landingStyles.recentCard, { width: recentWidth > 0 ? (recentWidth - 12) / 1.5 : 220 }]}
                        onPress={() => choose(restaurant)}>
                        <View style={landingStyles.recentFacts}>
                            <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">{restaurant.name}</Text>
                            <Text style={[styles.message, styles.cardMessage]} numberOfLines={2} ellipsizeMode="tail">{restaurant.address}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color="#79665E" accessible={false} importantForAccessibility="no" />
                    </Pressable>)}
                </ScrollView>}
        </>}
        {state.ready && <PreviousAddResults canOperate={canOperate} open={result => {
            if (choosing.current) return;
            choosing.current = true;
            leave.finish(() => router.push(destinationHref(result, "add")));
        }} />}
    </ScreenScaffold>}</PersonalAccess>;
}

const landingStyles = StyleSheet.create({
    sectionHeading: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    refresh: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
    recentList: { flexGrow: 0 },
    recentContent: { gap: 12, paddingBottom: 4 },
    recentCard: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 132, marginBottom: 0 },
    recentFacts: { flex: 1, minWidth: 0, gap: 8 },
});
