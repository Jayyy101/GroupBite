import { ScreenScaffold } from "@/components/screen-scaffold";
import { backendStyles as styles } from "@/styles/backend";
import { useRouter } from "expo-router";
import { Pressable, Text } from "react-native";

export default function AddScreen() {
    const router = useRouter();
    return <ScreenScaffold>
        <Text style={styles.title}>Save a place</Text>
        <Text style={styles.message}>Keep a private memory or add a visit to a group.</Text>
        <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => router.push("/personal-place-form")}>
            <Text style={styles.primaryText}>Only me</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => router.push("/add-visit")}>
            <Text style={styles.secondaryText}>Add a group visit</Text>
        </Pressable>
    </ScreenScaffold>;
}
