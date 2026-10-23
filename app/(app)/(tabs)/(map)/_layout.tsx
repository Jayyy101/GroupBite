import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "saved-map" };

export default function SectionLayout() {
    return <Stack screenOptions={{ headerShown: false }} />;
}
