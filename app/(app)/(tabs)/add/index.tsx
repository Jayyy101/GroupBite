import { AddResults, PreviousAddResults } from "@/components/add-results";
import { PersonalAccess } from "@/components/personal-access";
import { RestaurantSearch } from "@/components/restaurant-search";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { accountAccessToken } from "@/lib/account-session";
import { recentRestaurantChoices } from "@/lib/recent-restaurants";
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
import { AppState, Pressable, Text } from "react-native";

export default function AddScreen() {
    const { session } = useAuth();
    return session ? <AddLanding key={session.user.id} userId={session.user.id} /> : <PersonalAccess title="Add">{() => null}</PersonalAccess>;
}
function AddLanding({ userId }: { userId: string }) {
    const router = useRouter(), { coordinator, state } = useUnifiedAdd();
    const { session, loading: authLoading } = useAuth();
    const focused = useIsFocused(), { isActive, version } = useForegroundRefresh();
    const alive = useRef(false), active = useRef(false);
    const choosing = useRef(false);
    active.current = focused && isActive && !authLoading && session?.user.id === userId;
    const [recent, setRecent] = useState<AddRestaurant[]>([]), [error, setError] = useState("");
    const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
    const canOperate = () => alive.current && active.current && AppState.currentState === "active";
    const groupRecovery = state.attempts.some(attempt => attempt.destination.kind === "group")
        || state.previous.some(previous => previous.attempts.some(attempt => attempt.destination.kind === "group"));
    const unresolved = !!state.error || state.attempts.some(a => a.status !== "saved");
    const leave = useLeaveGuard({ userId, dirty: false, busy: state.busy, uncertain: unresolved,
        uncertainExitMessage: "Some destinations may already have saved. Finishing does not undo them. Review every destination before starting a separate save. Leaving this screen keeps recovery available in Add." });
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
                const response = await withRequestDeadline(signal => supabase.rpc("get_recent_add_restaurants", { page_size: 12, page_offset: 0 })
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
        if (!canOperate() || choosing.current || !coordinator.state.ready || coordinator.state.busy || coordinator.state.attempts.length || coordinator.state.error) return;
        choosing.current = true;
        coordinator.selectRestaurant(restaurant); router.push("/add-visit");
    }
    return <PersonalAccess title="Add">{() => <ScreenScaffold keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {leave.confirmation}
        {!state.ready ? <Text style={styles.message}>Checking save recovery...</Text> : state.attempts.length || state.error ? <AddResults canOperate={canOperate}
            separate={async (expected, temporary) => {
                const result = await coordinator.startSeparate(expected, canOperate, temporary);
                if (result === "started" && canOperate()) { choosing.current = false; leave.finish(() => router.dismissTo("/add")); }
                return result;
            }}
            open={result => {
                if (choosing.current) return;
                choosing.current = true;
                leave.finish(() => router.push(destinationHref(result, true)));
            }}
            done={async () => {
                if (!canOperate()) return;
                if (isConfirmedAdd(coordinator.state)) {
                    if (await coordinator.clearConfirmed() && canOperate()) leave.finish(() => router.dismissTo("/add"));
                } else leave.requestLeave(() => router.navigate("/"));
            }} /> : <>
            <Text style={styles.title}>Save a restaurant</Text>
            <Text style={styles.message}>Find a restaurant, then choose My Places, your groups, or both.</Text>
            <RestaurantSearch onSelect={choose} />
            <Text style={styles.label}>Recently saved restaurants</Text>
            <Text style={styles.message}>Choosing a restaurant does not select where to save your next visit.</Text>
            {loading ? <Text style={styles.message}>Loading recent restaurants...</Text> : error ? <Text style={styles.error}>{error}</Text> : !recent.length
                ? <Text style={styles.message}>No saved restaurants yet.</Text> : recent.map((restaurant, index) => <Pressable key={`${restaurant.entry_id}:${index}`}
                    accessibilityRole="button" style={styles.card} onPress={() => choose(restaurant)}>
                    <Text style={styles.cardTitle}>{restaurant.name}</Text><Text style={styles.message}>{restaurant.address}</Text></Pressable>)}
            <Pressable accessibilityRole="button" disabled={loading} style={styles.secondaryButton} onPress={() => { if (canOperate()) setRefresh(v => v + 1); }}>
                <Text style={styles.secondaryText}>Refresh Recent Restaurants</Text></Pressable>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => choose(null)}>
                <Text style={styles.primaryText}>Enter Restaurant Manually</Text></Pressable>
        </>}
        {state.ready && <PreviousAddResults canOperate={canOperate} open={result => {
            if (choosing.current) return;
            choosing.current = true;
            leave.finish(() => router.push(destinationHref(result, true)));
        }} />}
    </ScreenScaffold>}</PersonalAccess>;
}
