import { authErrorMessage } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { Group } from "@/types/database";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

export default function GroupsScreen() {
    const router = useRouter();
    const { session, loading, error } = useAuth();

    if (!loading && session) {
        // Remount when the account changes so one user's groups never carry over.
        return <SignedInGroups key={session.user.id} userId={session.user.id} />;
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>Groups</Text>
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            <Text style={styles.message}>{loading ? "Restoring your session..." : "Sign in to create and view your private groups."}</Text>
            {!loading && (
                <Pressable accessibilityRole="button" onPress={() => router.replace("/auth")} style={styles.primaryButton}>
                    <Text style={styles.primaryText}>Sign In / Sign Up</Text>
                </Pressable>
            )}
        </ScrollView>
    );
}

function SignedInGroups({ userId }: { userId: string }) {
    const router = useRouter();
    const [groups, setGroups] = useState<Group[]>([]);
    const [displayName, setDisplayName] = useState("");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const [error, setError] = useState("");
    const [loadError, setLoadError] = useState("");

    useFocusEffect(useCallback(() => {
        let active = true;
        async function loadGroups() {
            setLoading(true);
            setLoadError("");
            try {
                const [groupsResult, profileResult] = await Promise.all([
                    supabase.from("groups").select("*").order("created_at", { ascending: false }),
                    supabase.from("profiles").select("display_name").eq("id", userId).single(),
                ]);
                if (groupsResult.error) throw groupsResult.error;
                if (profileResult.error) throw profileResult.error;
                if (active) {
                    setGroups(groupsResult.data);
                    setDisplayName(profileResult.data.display_name);
                }
            } catch {
                if (active) setLoadError("Could not load your groups. Check your connection and return to this screen to try again.");
            } finally {
                if (active) setLoading(false);
            }
        }
        loadGroups();
        return () => { active = false; };
    }, [userId]));

    async function handleCreate() {
        if (creating || signingOut || loading) return;
        setError("");
        if (name.trim() === "") {
            setError("Please enter a group name.");
            return;
        }
        setCreating(true);
        try {
            const { error } = await supabase.rpc("create_group", { group_name: name.trim() });
            if (error) throw error;
            // Read the committed group through RLS rather than trusting an RPC payload.
            const result = await supabase.from("groups").select("*").order("created_at", { ascending: false });
            if (result.error) {
                setLoadError("Your group was created. Return to this screen to reload the list.");
            } else {
                setGroups(result.data);
                setLoadError("");
            }
            setName("");
        } catch {
            setError("Could not create the group. Check your connection and try again.");
        } finally {
            setCreating(false);
        }
    }

    async function handleSignOut() {
        if (creating || signingOut) return;
        setError("");
        setSigningOut(true);
        try {
            const { error } = await supabase.auth.signOut({ scope: "local" });
            if (error) throw error;
            router.dismissTo("/");
        } catch (error) {
            setError(authErrorMessage(error));
        } finally {
            setSigningOut(false);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable accessibilityRole="button" disabled={creating || signingOut} onPress={() => router.canGoBack() ? router.back() : router.replace("/")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>Groups</Text>
            {displayName !== "" && <Text style={styles.message}>Signed in as {displayName}</Text>}
            <Text style={styles.label}>New group name</Text>
            <TextInput
                accessibilityLabel="New group name"
                value={name}
                onChangeText={setName}
                placeholder="Enter a group name"
                placeholderTextColor="#79665E"
                maxLength={100}
                editable={!creating && !signingOut}
                style={styles.input}
            />
            <Pressable accessibilityRole="button" disabled={loading || creating || signingOut} onPress={handleCreate} style={[styles.primaryButton, (loading || creating || signingOut) && styles.disabled]}>
                <Text style={styles.primaryText}>{creating ? "Creating..." : "Create Group"}</Text>
            </Pressable>
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {loadError !== "" && <Text style={styles.error}>{loadError}</Text>}
            {loading ? <Text style={styles.message}>Loading groups...</Text> : (
                <>
                    {loadError === "" && groups.length === 0 && <Text style={styles.message}>No groups yet. Create your first group above!</Text>}
                    {groups.map(group => (
                        <View key={group.id} style={styles.card}>
                            <Text style={styles.cardTitle}>{group.name}</Text>
                            <Text style={styles.message}>{group.owner_user_id === userId ? "Owner" : "Member"}</Text>
                        </View>
                    ))}
                </>
            )}
            <Pressable accessibilityRole="button" disabled={creating || signingOut} onPress={handleSignOut} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>{signingOut ? "Signing out..." : "Sign Out"}</Text>
            </Pressable>
        </ScrollView>
    );
}
