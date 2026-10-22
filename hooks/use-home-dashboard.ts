import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { loadingCollectionStatistics, readCollectionStatistics, unavailableCollectionStatistics, verifyCollectionMemberships } from "@/lib/collection-statistics";
import { emptyHomeDashboard, hideDashboardGroups, homeDashboardView, readHomeDashboard, verifyDashboardGroups } from "@/lib/home-dashboard";
import { useAuth } from "@/providers/auth";
import type { HomeDashboardSnapshot } from "@/types/home-dashboard";
import type { CollectionStatisticsRead } from "@/types/collection-statistics";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

// Home owns this hook; it has no persistent/global cache and touches no recovery
// provider. Detail links should use entryId (plus groupId for group entries).
export function useHomeDashboard({ includeCollections = false }: { includeCollections?: boolean } = {}) {
    const { session, loading: authLoading } = useAuth();
    const userId = session?.user.id;
    const focused = useIsFocused();
    const { version: foregroundVersion, isActive } = useForegroundRefresh();
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [loaded, setLoaded] = useState<{ key: string; snapshot: HomeDashboardSnapshot; collections: CollectionStatisticsRead | null } | null>(null);
    const queue = useRef<Promise<void>>(Promise.resolve());
    const cancel = useRef<(() => void) | null>(null);
    const key = JSON.stringify([userId, authLoading, focused, isActive, foregroundVersion, refreshVersion, includeCollections]);
    const currentKey = useRef(key); currentKey.current = key;
    const eligible = !!userId && !authLoading && focused && isActive;

    const refresh = useCallback(() => {
        // Invalidate synchronously, before React renders the next refresh version.
        cancel.current?.();
        setRefreshVersion(value => value + 1);
    }, []);

    useEffect(() => {
        setLoaded(null);
        if (!eligible || !userId) return;
        const controller = new AbortController();
        let active = true, pending = true;
        let snapshot: HomeDashboardSnapshot | null = null;
        let collections: CollectionStatisticsRead | null = null;
        const invalidate = () => { active = false; controller.abort(); };
        cancel.current = invalidate;
        const canPublish = () => active && !controller.signal.aborted && currentKey.current === key && AppState.currentState === "active";
        const context = { userId, signal: controller.signal };
        // Serialize even across account/focus changes. Canceled queued work never
        // starts; an old in-flight batch must settle before a new batch dispatches.
        queue.current = queue.current.then(async () => {
            if (!canPublish()) return;
            try {
                const [homeResult, collectionResult] = await Promise.allSettled([
                    readHomeDashboard(context), includeCollections ? readCollectionStatistics(context) : Promise.resolve(null),
                ]);
                if (homeResult.status === "rejected") throw homeResult.reason;
                if (collectionResult.status === "rejected") throw collectionResult.reason;
                let next = homeResult.value;
                collections = collectionResult.value;
                // Either independent batch can finish first. Recheck both sets
                // of admissions before publishing the combined result.
                if (collections) {
                    const checks = await Promise.allSettled([
                        verifyDashboardGroups(context, next), verifyCollectionMemberships(context, collections),
                    ]);
                    if (checks.some(check => check.status === "rejected")) {
                        collections = unavailableCollectionStatistics();
                        next = hideDashboardGroups(next);
                    }
                }
                if (canPublish()) {
                    snapshot = next;
                    setLoaded({ key, snapshot, collections });
                }
            } catch { /* Lifecycle cancellation: the next eligible batch owns state. */ }
            finally { pending = false; }
        });

        const timer = setInterval(() => {
            if (!canPublish() || pending || !snapshot) return;
            pending = true;
            queue.current = queue.current.then(async () => {
                try {
                    const results = await Promise.allSettled([verifyDashboardGroups(context, snapshot!),
                        collections ? verifyCollectionMemberships(context, collections) : Promise.resolve()]);
                    for (const result of results) if (result.status === "rejected") throw result.reason;
                }
                catch {
                    if (canPublish() && snapshot) {
                        collections = includeCollections ? unavailableCollectionStatistics() : null;
                        setLoaded({ key, snapshot: hideDashboardGroups(snapshot), collections });
                        snapshot = null; // Explicit Refresh is required after access uncertainty.
                    }
                } finally { pending = false; }
            });
        }, 15000);
        const subscription = AppState.addEventListener("change", state => {
            // Abort synchronously even if background/return events are batched
            // before React commits the foreground-version update.
            if (state !== "active") invalidate();
        });
        return () => {
            invalidate();
            clearInterval(timer);
            subscription.remove();
            if (cancel.current === invalidate) cancel.current = null;
        };
    }, [eligible, userId, key, includeCollections]);

    // Render-time gating prevents even one render of the previous account/focus/
    // refresh snapshot before the effect cleanup has run.
    const snapshot = eligible && AppState.currentState === "active" && loaded?.key === key
        ? loaded.snapshot : emptyHomeDashboard();
    const collectionStatistics = includeCollections ? (eligible && AppState.currentState === "active" && loaded?.key === key
        ? loaded.collections?.statistics ?? loadingCollectionStatistics() : loadingCollectionStatistics()) : null;
    return { ...homeDashboardView(snapshot), collectionStatistics, refresh };
}
