import { backendStyles } from "@/styles/backend";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function Index() {
  const router = useRouter();

  return (
    <ScreenScaffold contentContainerStyle={{ paddingTop: 24 }}>
      <Text style={styles.welcomeText}>Welcome to</Text>
      <Text style={styles.title}>GroupBite</Text>
      <Text style={styles.description}>
        Save your favorite food spots and find your next bite.
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/my-places")}
        style={[backendStyles.secondaryButton, styles.secondaryButton]}
      >
        <Text style={backendStyles.secondaryText}>My Places</Text>
      </Pressable>

      <View style={styles.emptyState}>
        <Text style={styles.emptyStateTitle}>Your restaurants and visits</Text>
        <Text style={styles.emptyStateText}>
          My Places keeps your private memories. Groups holds the visits you share with friends.
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/groups")}
        style={[backendStyles.secondaryButton, styles.secondaryButton]}
      >
        <Text style={backendStyles.secondaryText}>Groups</Text>
      </Pressable>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  welcomeText: {
    color: "#7A5C4F",
    fontSize: 18,
    marginBottom: 4,
  },
  title: {
    color: "#2D1F1A",
    fontSize: 42,
    fontWeight: "700",
  },
  description: {
    color: "#66524A",
    fontSize: 17,
    lineHeight: 25,
    marginTop: 12,
    maxWidth: 320,
  },
  secondaryButton: { marginTop: 12, marginBottom: 0 },
  emptyState: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    marginTop: 36,
    padding: 24,
  },
  emptyStateTitle: {
    color: "#2D1F1A",
    fontSize: 19,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyStateText: {
    color: "#79665E",
    fontSize: 15,
    lineHeight: 22,
  },
});
