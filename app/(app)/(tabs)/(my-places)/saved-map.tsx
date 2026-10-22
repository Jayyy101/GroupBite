import SavedMapScreen from "@/components/saved-map-screen";
import { useAuth } from "@/providers/auth";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Platform } from "react-native";

export default function SavedMapRoute() {
    const { session } = useAuth();
    const { fromHome } = useLocalSearchParams<{ fromHome?: string }>();
    if (!__DEV__ || Platform.OS !== "ios") return <Redirect href="/my-places" />;
    return session ? <SavedMapScreen key={session.user.id} userId={session.user.id} fromHome={fromHome === "1"} /> : null;
}
