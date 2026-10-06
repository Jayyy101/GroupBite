import { authErrorMessage } from "@/lib/auth-errors";
import { groupErrorMessage } from "@/lib/group-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { Group, JoinRequest } from "@/types/database";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
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
    const [inviteCode, setInviteCode] = useState("");
    const [requesting, setRequesting] = useState(false);
    const [requestMessage, setRequestMessage] = useState("");
    const [requests, setRequests] = useState<Pick<JoinRequest, "id" | "status" | "requested_at">[]>([]);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const busy = creating || requesting || signingOut;
    const isFocused = useIsFocused();

    useEffect(() => {
        if (!isFocused) return;
        let active = true;
        async function loadGroups() {
            setLoading(true);
            setLoadError("");
            try {
                const [groupsResult, profileResult, requestsResult] = await Promise.all([
                    supabase.from("groups").select("*").order("created_at", { ascending: false }),
                    supabase.from("profiles").select("display_name").eq("id", userId).single(),
                    supabase.from("join_requests").select("id,group_id,status,requested_at").eq("user_id", userId).order("requested_at", { ascending: false }),
                ]);
                if (groupsResult.error) throw groupsResult.error;
                if (profileResult.error) throw profileResult.error;
                if (requestsResult.error) throw requestsResult.error;
                if (active) {
                    setGroups(groupsResult.data);
                    setDisplayName(profileResult.data.display_name);
                    // The group card replaces an approved request once membership is visible.
                    setRequests(requestsResult.data.filter(request =>
                        request.status !== "approved" || !groupsResult.data.some(group => group.id === request.group_id)
                    ));
                }
            } catch {
                if (active) setLoadError("Could not load your groups. Check your connection and return to this screen to try again.");
            } finally {
                if (active) setLoading(false);
            }
        }
        loadGroups();
        return () => { active = false; };
    }, [userId, isFocused, refreshVersion]);

    async function handleCreate() {
        if (busy || loading) return;
        setError("");
        if (name.trim() === "") {
            setError("Please enter a group name.");
            return;
        }
        setCreating(true);
        try {
            const { error } = await supabase.rpc("create_group", { group_name: name.trim() });
            if (error) throw error;
            setName("");
            setRefreshVersion(value => value + 1);
        } catch {
            setError("Could not create the group. Check your connection and try again.");
        } finally {
            setCreating(false);
        }
    }

    async function handleRequest() {
        if (busy || loading) return;
        setError("");
        setRequestMessage("");
        if (inviteCode.trim() === "") {
            setError("Please enter an invite code.");
            return;
        }
        setRequesting(true);
        try {
            const { error } = await supabase.rpc("request_group_access", { invite_code: inviteCode.trim() });
            if (error) throw error;
            setInviteCode("");
            setRequestMessage("Request sent. The Owner must approve it before you can access the group.");
            setRefreshVersion(value => value + 1);
        } catch (error) {
            setError(groupErrorMessage(error));
        } finally {
            setRequesting(false);
        }
    }

    async function handleSignOut() {
        if (busy) return;
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
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.canGoBack() ? router.back() : router.replace("/")} style={[styles.secondaryButton, styles.backButton]}>
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
                editable={!busy}
                style={styles.input}
            />
            <Pressable accessibilityRole="button" disabled={loading || busy} onPress={handleCreate} style={[styles.primaryButton, (loading || busy) && styles.disabled]}>
                <Text style={styles.primaryText}>{creating ? "Creating..." : "Create Group"}</Text>
            </Pressable>
            <Text style={styles.label}>Join a private group</Text>
            <TextInput
                accessibilityLabel="Invite code"
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="Paste an invite code"
                placeholderTextColor="#79665E"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                maxLength={64}
                editable={!busy}
                style={styles.input}
            />
            <Pressable accessibilityRole="button" disabled={loading || busy} onPress={handleRequest} style={[styles.primaryButton, (loading || busy) && styles.disabled]}>
                <Text style={styles.primaryText}>{requesting ? "Sending request..." : "Request Access"}</Text>
            </Pressable>
            {requestMessage !== "" && <Text style={styles.message}>{requestMessage}</Text>}
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            {loadError !== "" && <Text style={styles.error}>{loadError}</Text>}
            {loading ? <Text style={styles.message}>Loading groups...</Text> : (
                <>
                    {groups.length > 0 && (
                        <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push("/add-visit")} style={styles.primaryButton}>
                            <Text style={styles.primaryText}>Add Restaurant / Visit</Text>
                        </Pressable>
                    )}
                    {loadError === "" && groups.length === 0 && <Text style={styles.message}>No groups yet. Create your first group above!</Text>}
                    {groups.map(group => (
                        <Pressable key={group.id} accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: "/group/[id]", params: { id: group.id } })} style={styles.card}>
                            <Text style={styles.cardTitle}>{group.name}</Text>
                            <Text style={styles.message}>{group.owner_user_id === userId ? "Owner" : "Member"}</Text>
                        </Pressable>
                    ))}
                    {requests.length > 0 && <Text style={styles.label}>Your join requests</Text>}
                    {requests.map(request => (
                        <View key={request.id} style={styles.card}>
                            <Text style={styles.cardTitle}>
                                {request.status === "pending" ? "Pending approval" : request.status === "approved" ? "Approved" : "Denied"}
                            </Text>
                            <Text style={styles.message}>Requested {new Date(request.requested_at).toLocaleDateString()}</Text>
                        </View>
                    ))}
                </>
            )}
            <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => setRefreshVersion(value => value + 1)} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Refresh Groups and Requests</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={handleSignOut} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>{signingOut ? "Signing out..." : "Sign Out"}</Text>
            </Pressable>
        </ScrollView>
    );
}
