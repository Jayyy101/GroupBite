import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";

export const unstable_settings = { initialRouteName: "index" };

const icons: Record<string, ComponentProps<typeof Ionicons>["name"]> = {
    index: "home-outline", "my-places": "bookmark-outline", add: "add-circle-outline",
    groups: "people-outline", account: "person-circle-outline",
};

export default function TabLayout() {
    return <Tabs initialRouteName="index" backBehavior="history" screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#C9472C",
        tabBarInactiveTintColor: "#79665E",
        tabBarStyle: { backgroundColor: "#FFF8F0", borderTopColor: "#E8DACE" },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarHideOnKeyboard: true,
        tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} color={color} size={size} />,
    })}>
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="my-places" options={{ title: "My Places" }} />
        <Tabs.Screen name="add" options={{ title: "Add" }} />
        <Tabs.Screen name="groups" options={{ title: "Groups" }} />
        <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>;
}
