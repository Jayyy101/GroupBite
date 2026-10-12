import { LegacyArchiveProvider } from "@/providers/legacy-archive";
import { authReturnTo } from "@/lib/auth-navigation";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import { useIsFocused } from "@react-navigation/native";
import { Redirect, Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";

export const unstable_settings = { initialRouteName: "(tabs)" };

export default function AppLayout() {
    const { session, loading } = useAuth();
    const pathname = usePathname();
    const params = useGlobalSearchParams();
    const focused = useIsFocused();
    const wasSignedIn = useRef(false);
    if (loading) return <View style={[styles.screen, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color="#E85D3F" />
        <Text style={styles.message}>Restoring your session...</Text>
    </View>;
    if (!session) return focused ? <Redirect href={{ pathname: "/auth", params: {
        returnTo: wasSignedIn.current ? "/" : authReturnTo(pathname, params),
    } }} /> : null;
    wasSignedIn.current = true;
    // Replacing an account disposes every route, draft, request and archive grant.
    return <LegacyArchiveProvider key={session.user.id}>
        <Stack key={session.user.id} screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
        </Stack>
    </LegacyArchiveProvider>;
}
