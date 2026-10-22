import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { readSavedMap } from "@/lib/saved-map-data";
import { useAuth } from "@/providers/auth";
import type { SavedMapData } from "@/types/saved-map";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export function useSavedMap(userId: string) {
    const { session, loading } = useAuth(), focused = useIsFocused();
    const { isActive, version } = useForegroundRefresh();
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [loaded, setLoaded] = useState<{ key: string; data: SavedMapData | null; error: string } | null>(null);
    const key = JSON.stringify([userId, session?.user.id, loading, focused, isActive, version, refreshVersion]);
    const currentKey = useRef(key); currentKey.current = key;
    const cancel = useRef<(() => void) | null>(null);
    const eligible = !loading && session?.user.id === userId && focused && isActive;
    const refresh = useCallback(() => { cancel.current?.(); setLoaded(null); setRefreshVersion(v => v + 1); }, []);
    useEffect(() => {
        setLoaded(null);
        if (!eligible) return;
        const controller = new AbortController(); let valid = true;
        const invalidate = () => { valid = false; controller.abort(); };
        cancel.current = invalidate;
        const canPublish = () => valid && !controller.signal.aborted && key === currentKey.current && AppState.currentState === "active";
        void readSavedMap(userId, controller.signal).then(data => {
            if (canPublish()) setLoaded({ key, data, error: "" });
        }).catch(() => {
            if (canPublish()) setLoaded({ key, data: null, error: "Could not verify your saved restaurants. Refresh to try again." });
        });
        const listener = AppState.addEventListener("change", state => { if (state !== "active") invalidate(); });
        return () => { invalidate(); listener.remove(); if (cancel.current === invalidate) cancel.current = null; };
    }, [eligible, userId, key]);
    const visible = eligible && AppState.currentState === "active" && loaded?.key === key ? loaded : null;
    return { data: visible?.data ?? null, error: visible?.error ?? "", loading: eligible && !visible, eligible, refresh };
}
