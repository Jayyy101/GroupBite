import { Stack } from "expo-router";

export const unstable_settings = { initialRouteName: "index" };

// Home browsing retains the Dashboard under details and Saved Map, just as the
// collection and Add stacks retain their own browsing/result context.
export default function HomeLayout() {
    return <Stack screenOptions={{ headerShown: false }} />;
}
