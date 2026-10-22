import type { DetailOrigin } from "@/lib/restaurant-navigation";
import SavedMapScreen from "@/components/saved-map-screen";
import { useAuth } from "@/providers/auth";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";

export default function SavedMapRoute({ origin = "map" }: { origin?: DetailOrigin }) {
    const { session } = useAuth();
    const { fromHome } = useLocalSearchParams<{ fromHome?: string }>();
    if (!__DEV__ || Platform.OS !== "ios") return <Redirect href="/my-places" />;
    if (fromHome === "1" && origin !== "home") return <Redirect href="/home/saved-map" />;
    return session ? <SavedMapScreen key={session.user.id} userId={session.user.id} origin={origin} /> : null;
}
