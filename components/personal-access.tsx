import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text } from "react-native";

export function PersonalAccess({ title, children }: { title: string; children: (userId: string) => ReactNode }) {
    const router = useRouter();
    const { session, loading, error } = useAuth();
    const focused = useIsFocused();
    const { isActive } = useForegroundRefresh();
    // Unmount account data, drafts and confirmations on blur/background/sign-out.
    // Returning mounts a fresh owner-scoped read; keyed children isolate accounts.
    if (!focused || !isActive) return null;
    if (!loading && session) return children(session.user.id);
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{loading ? "Restoring your session..." : "Sign in to save and view your private Places. No group is required."}</Text>
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {!loading && <Pressable accessibilityRole="button" onPress={() => router.push("/auth")} style={styles.primaryButton}>
                <Text style={styles.primaryText}>Sign In / Sign Up</Text>
            </Pressable>}
        </ScrollView>
    );
}
