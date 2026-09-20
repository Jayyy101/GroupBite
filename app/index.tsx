import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function Index() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <Text style={styles.welcomeText}>Welcome to</Text>
      <Text style={styles.title}>GroupBite</Text>
      <Text style={styles.description}>
        Save your favorite food spots and find your next bite.
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/add-place")}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Add a Place</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/saved-places")}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>View Saved Places</Text>
      </Pressable>

      <View style={styles.emptyState}>
        <Text style={styles.emptyStateTitle}>No saved places yet</Text>
        <Text style={styles.emptyStateText}>
          Your favorite restaurants will appear here after you add them.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFF8F0",
    paddingHorizontal: 24,
    paddingTop: 80,
  },
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
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#E85D3F",
    borderRadius: 14,
    marginTop: 36,
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#E85D3F",
    borderRadius: 14,
    borderWidth: 2,
    marginTop: 12,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#C9472C",
    fontSize: 17,
    fontWeight: "600",
  },
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