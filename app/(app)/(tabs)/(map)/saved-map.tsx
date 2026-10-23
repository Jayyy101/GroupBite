import type { DetailOrigin } from "@/lib/restaurant-navigation";
import SavedMapScreen from "@/components/saved-map-screen";
import { useAuth } from "@/providers/auth";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Platform, Text } from "react-native";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { backendStyles } from "@/styles/backend";

export default function SavedMapRoute({ origin = "map" }: { origin?: DetailOrigin }) {
    const { session } = useAuth();
    const { fromHome } = useLocalSearchParams<{ fromHome?: string }>();
    if (!__DEV__ || Platform.OS !== "ios") return <ScreenScaffold title="Map">
        <Text style={backendStyles.message}>Saved Map is currently available in the iOS development build. Browse your saved restaurants in Collections.</Text>
    </ScreenScaffold>;
    if (fromHome === "1" && origin !== "home") return <Redirect href="/home/saved-map" />;
    return session ? <SavedMapScreen key={session.user.id} userId={session.user.id} origin={origin} tabRoot={origin === "map"} /> : null;
}
