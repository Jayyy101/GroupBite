import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "groups" };

export default function SectionLayout() {
    // Experiment A draws its status-bar treatment and Back inside the details.
    return <Stack screenOptions={{ headerShown: false }} />;
}
