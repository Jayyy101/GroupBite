import { StyleSheet } from "react-native";

// Shared styles for the new authentication and groups screens.
export const backendStyles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: "#FFF8F0" },
    content: { paddingTop: 60, paddingHorizontal: 24, paddingBottom: 32 },
    title: { color: "#2D1F1A", fontSize: 30, fontWeight: "700", marginBottom: 24 },
    label: { color: "#2D1F1A", fontSize: 17, fontWeight: "600", marginBottom: 8 },
    input: {
        backgroundColor: "#FFFFFF", color: "#2D1F1A", borderWidth: 1,
        borderColor: "#BFA99B", borderRadius: 12, paddingHorizontal: 16,
        paddingVertical: 14, fontSize: 17, marginBottom: 16,
    },
    primaryButton: {
        backgroundColor: "#E85D3F", alignItems: "center", justifyContent: "center",
        minHeight: 56, borderRadius: 14, marginBottom: 16, paddingHorizontal: 16,
    },
    primaryText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
    secondaryButton: {
        borderWidth: 1, borderColor: "#E85D3F", borderRadius: 12,
        minHeight: 48, alignItems: "center", justifyContent: "center",
        paddingHorizontal: 16, marginBottom: 24,
    },
    backButton: { alignSelf: "flex-start" },
    secondaryText: { color: "#C9472C", fontSize: 16, fontWeight: "600" },
    message: { color: "#79665E", fontSize: 16, lineHeight: 24, marginBottom: 16 },
    error: { color: "#B42318", fontSize: 16, lineHeight: 24, marginBottom: 16 },
    card: {
        backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#BFA99B",
        borderRadius: 12, padding: 16, marginBottom: 12,
    },
    cardTitle: { color: "#2D1F1A", fontSize: 17, fontWeight: "600" },
    disabled: { opacity: 0.6 },
});
