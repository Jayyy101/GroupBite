import { ScreenScaffold } from "@/components/screen-scaffold";
import { authErrorMessage } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";

export default function AccountScreen() {
    const { session } = useAuth();
    return session ? <Account key={session.user.id} email={session.user.email} /> : null;
}

function Account({ email }: { email?: string }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false), mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function signOut() {
        if (submitting.current || !mounted.current) return;
        submitting.current = true; setBusy(true); setError("");
        try {
            const { error } = await supabase.auth.signOut({ scope: "local" });
            if (error) throw error;
            // Auth-state change unmounts the entire authenticated navigator.
        } catch (error) {
            if (mounted.current) setError(authErrorMessage(error));
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    return <ScreenScaffold>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.label}>Signed in as</Text>
        <Text selectable style={styles.message}>{email || "Your GroupBite account"}</Text>
        {error !== "" && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} style={[styles.secondaryButton, busy && styles.disabled]} onPress={signOut}>
            <Text style={styles.secondaryText}>{busy ? "Signing out..." : "Sign Out"}</Text>
        </Pressable>
        <Text style={styles.label}>Older records</Text>
        <Text style={styles.message}>Device-only records are separate from your account. Review the archive only if this device&apos;s older records are yours.</Text>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondaryButton} onPress={() => router.push("/saved-places")}>
            <Text style={styles.secondaryText}>Review device-only archive</Text>
        </Pressable>
    </ScreenScaffold>;
}
