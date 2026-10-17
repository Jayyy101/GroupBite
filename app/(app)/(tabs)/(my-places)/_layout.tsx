import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "my-places" };

export default function SectionLayout() {
    return <Stack screenOptions={{ headerShown: false }} />;
}
