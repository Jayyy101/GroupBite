import { PersonalAccess } from "@/components/personal-access";
import { useLegacyArchive } from "@/providers/legacy-archive";
import { backendStyles as styles } from "@/styles/backend";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text } from "react-native";

export function LegacyAccess({ children }: { children: ReactNode }) {
    return <PersonalAccess title="Device-only archive">{() => <ArchiveGate>{children}</ArchiveGate>}</PersonalAccess>;
}

function ArchiveGate({ children }: { children: ReactNode }) {
    const { allowed, allow } = useLegacyArchive();
    const router = useRouter();
    if (allowed) return children;
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Device-only archive</Text>
        <Text style={styles.message}>These older records are stored on this device and are not linked to any account. They may belong to someone else who used this device. Open them only if they are yours.</Text>
        <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={allow}>
            <Text style={styles.primaryText}>These are my records — open archive</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => router.replace("/account")}>
            <Text style={styles.secondaryText}>Return to Account</Text>
        </Pressable>
    </ScrollView>;
}
