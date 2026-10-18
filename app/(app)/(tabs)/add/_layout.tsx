import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "index" };

export default function AddLayout() {
    return <Stack screenOptions={{ headerShown: false }} />;
}
