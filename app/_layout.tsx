import { Stack } from "expo-router";
import { AuthProvider } from "@/providers/auth";
import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { Appearance, Platform } from "react-native";

// V1 has a light palette throughout. Keep native controls and navigation in
// agreement with it until dark colors are designed across all app screens.
// The runtime override also covers existing development builds; app.json owns
// the native launch appearance. React Native Web has no setColorScheme API.
if (Platform.OS !== "web") Appearance.setColorScheme("light");
const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: "#C9472C", background: "#FFF8F0",
    card: "#FFF8F0", text: "#2D1F1A", border: "#E8DACE", notification: "#C9472C" },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="dark" />
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="auth" />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
