import Ionicons from "@expo/vector-icons/Ionicons";
import { selectTabRoot } from "@/lib/tab-navigation";
import { isConfirmedAdd } from "@/lib/unified-add";
import { useUnifiedAdd } from "@/providers/unified-add";
import { TabLeaveContext, type TabLeaveHandler } from "@/providers/tab-leave";
import { Tabs } from "expo-router";
import { useRef, type ComponentProps } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

export const unstable_settings = { initialRouteName: "index" };

const icons: Record<string, ComponentProps<typeof Ionicons>["name"]> = {
    index: "home-outline", "(my-places)": "bookmark-outline", add: "add-circle-outline",
    "(groups)": "people-outline", "(account)": "person-circle-outline",
};

export default function TabLayout() {
    const leaveHandler = useRef<TabLeaveHandler | null>(null);
    const { coordinator } = useUnifiedAdd();
    return <TabLeaveContext.Provider value={leaveHandler}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Tabs initialRouteName="index" backBehavior="history" screenListeners={({ navigation, route }) => ({
                tabPress: event => {
                    const select = async () => {
                        if (route.name === "add" && isConfirmedAdd(coordinator.state) && !await coordinator.clearConfirmed()) return;
                        selectTabRoot(navigation, route.key);
                    };
                    if (leaveHandler.current) {
                        event.preventDefault();
                        leaveHandler.current(() => { void select(); });
                    } else if (route.name === "add") { event.preventDefault(); void select(); }
                },
            })} screenOptions={({ route }) => ({
                headerShown: false,
                popToTopOnBlur: true,
                tabBarActiveTintColor: "#C9472C",
                tabBarInactiveTintColor: "#79665E",
                tabBarStyle: { backgroundColor: "#FFF8F0", borderTopColor: "#E8DACE" },
                tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
                tabBarHideOnKeyboard: false,
                tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} color={color} size={size} />,
            })}>
                <Tabs.Screen name="index" options={{ title: "Home" }} />
                <Tabs.Screen name="(my-places)" options={{ title: "My Places" }} />
                <Tabs.Screen name="add" options={{ title: "Add" }} />
                <Tabs.Screen name="(groups)" options={{ title: "Groups" }} />
                <Tabs.Screen name="(account)" options={{ title: "Account" }} />
            </Tabs>
        </KeyboardAvoidingView>
    </TabLeaveContext.Provider>;
}
