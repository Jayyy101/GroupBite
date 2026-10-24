// Local-only visual review of the actual shared field. No visit or Storage calls.
import { VisitDateField } from "@/components/visit-date-field";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { localToday } from "@/lib/visit-date";
import { backendStyles as styles } from "@/styles/backend";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

export default function VisitDatePreview() {
    const router = useRouter();
    const [date, setDate] = useState<string | null>(() => localToday());
    if (!__DEV__) return null;
    return <ScreenScaffold edgeToEdge includeBottomInset title="Visit date" onBack={() => router.canGoBack() ? router.back() : router.replace("/")}>
        <Text style={styles.contextLabel}>Design preview · Device only</Text>
        <Text style={styles.message}>The same calendar used when adding and editing visits. Changes here stay on this screen.</Text>
        <VisitDateField value={date} onChange={setDate} />
    </ScreenScaffold>;
}
