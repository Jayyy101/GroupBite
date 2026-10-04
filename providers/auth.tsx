import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

type AuthState = {
    session: Session | null;
    loading: boolean;
    error: string;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;
        let authEventReceived = false;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!active) return;
            authEventReceived = true;
            setSession(nextSession);
            setError("");
            setLoading(false);
        });

        supabase.auth.getSession().then(({ data, error }) => {
            if (!active || authEventReceived) return;
            setSession(data.session);
            if (error) setError("Could not restore your session. Please sign in again.");
            setLoading(false);
        }).catch(() => {
            if (!active || authEventReceived) return;
            setError("Could not restore your session. Please sign in again.");
            setLoading(false);
        });

        // Native apps refresh tokens only while active. Web handles this itself.
        function updateRefresh(state: string) {
            if (state === "active") supabase.auth.startAutoRefresh();
            else supabase.auth.stopAutoRefresh();
        }
        const appStateSubscription = Platform.OS !== "web"
            ? AppState.addEventListener("change", updateRefresh)
            : undefined;
        if (Platform.OS !== "web") updateRefresh(AppState.currentState);

        return () => {
            active = false;
            subscription.unsubscribe();
            appStateSubscription?.remove();
            if (Platform.OS !== "web") supabase.auth.stopAutoRefresh();
        };
    }, []);

    return <AuthContext.Provider value={{ session, loading, error }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const auth = useContext(AuthContext);
    if (!auth) throw new Error("useAuth must be used inside AuthProvider.");
    return auth;
}
