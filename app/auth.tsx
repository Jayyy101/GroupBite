import { authErrorMessage } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput } from "react-native";

export default function AuthScreen() {
    const router = useRouter();
    const { session, loading, error: sessionError } = useAuth();
    const [signingUp, setSigningUp] = useState(false);
    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    async function handleSubmit() {
        if (busy || loading) return;
        setError("");
        setMessage("");
        if (signingUp && displayName.trim() === "") {
            setError("Please enter a display name.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setError("Please enter a valid email address.");
            return;
        }
        if (password === "" || (signingUp && password.length < 6)) {
            setError(signingUp ? "Please use a password with at least 6 characters." : "Please enter your password.");
            return;
        }

        setBusy(true);
        try {
            if (signingUp) {
                const { data, error } = await supabase.auth.signUp({
                    email: email.trim(),
                    password,
                    options: { data: { display_name: displayName.trim() } },
                });
                if (error) throw error;
                if (!data.session) {
                    setMessage("Check your email for a verification link. After verifying, return here and sign in.");
                    setSigningUp(false);
                    setPassword("");
                }
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
                if (error) throw error;
            }
        } catch (error) {
            setError(authErrorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    if (!loading && session) return <Redirect href="/groups" />;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => router.canGoBack() ? router.back() : router.replace("/")}
                style={[styles.secondaryButton, styles.backButton]}
            >
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>{signingUp ? "Create Account" : "Sign In"}</Text>
            {loading ? <Text style={styles.message}>Restoring your session...</Text> : (
                <>
                    {sessionError !== "" && <Text style={styles.error}>{sessionError}</Text>}
                    {signingUp && (
                        <>
                            <Text style={styles.label}>Display name</Text>
                            <TextInput
                                accessibilityLabel="Display name"
                                style={styles.input}
                                placeholder="Your name"
                                placeholderTextColor="#79665E"
                                value={displayName}
                                onChangeText={setDisplayName}
                                maxLength={80}
                                editable={!busy}
                            />
                        </>
                    )}
                    <Text style={styles.label}>Email</Text>
                    <TextInput
                        key={Platform.OS === "ios" ? (signingUp ? "signup-email" : "signin-email") : undefined}
                        accessibilityLabel="Email"
                        style={styles.input}
                        placeholder="you@example.com"
                        placeholderTextColor="#79665E"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType={Platform.OS === "ios" ? "none" : undefined}
                        autoComplete={Platform.OS === "ios" ? undefined : "username"}
                        value={email}
                        onChangeText={setEmail}
                        editable={!busy}
                    />
                    <Text style={styles.label}>Password</Text>
                    {/* iOS workaround: bypass Password AutoFill while keeping the input secure. */}
                    <TextInput
                        key={signingUp ? "signup-password" : "signin-password"}
                        accessibilityLabel="Password"
                        style={styles.input}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType={Platform.OS === "ios" ? "oneTimeCode" : undefined}
                        autoComplete={Platform.OS === "ios" ? undefined : (signingUp ? "new-password" : "current-password")}
                        value={password}
                        onChangeText={setPassword}
                        editable={!busy}
                    />
                    {error !== "" && <Text style={styles.error}>{error}</Text>}
                    {message !== "" && <Text style={styles.message}>{message}</Text>}
                    <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={handleSubmit}
                        style={[styles.primaryButton, busy && styles.disabled]}
                    >
                        <Text style={styles.primaryText}>{busy ? "Please wait..." : signingUp ? "Sign Up" : "Sign In"}</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => {
                            setSigningUp(!signingUp);
                            setError("");
                            setMessage("");
                            setPassword("");
                        }}
                        style={styles.secondaryButton}
                    >
                        <Text style={styles.secondaryText}>{signingUp ? "Already have an account? Sign In" : "Create an Account"}</Text>
                    </Pressable>
                </>
            )}
        </ScrollView>
    );
}
