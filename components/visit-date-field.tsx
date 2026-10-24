import Ionicons from "@expo/vector-icons/Ionicons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { localToday, visitDateLabel, visitDateToLocal } from "@/lib/visit-date";
import { backendStyles as styles } from "@/styles/backend";
import { useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";

export function VisitDateField({ value, onChange, disabled = false, accessibilityLabel = "Visit date" }: {
    value: string | null; onChange: (value: string | null) => void; disabled?: boolean; accessibilityLabel?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const selected = visitDateToLocal(value) ?? visitDateToLocal(localToday())!;
    function select(date: Date) {
        if (!disabled && Number.isFinite(date.getTime())) onChange(localToday(date));
    }
    return <View style={dateStyles.section}>
        <Text style={styles.label}>Visit date (optional)</Text>
        <View style={dateStyles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
                accessibilityHint="Opens the calendar" accessibilityValue={{ text: value ? visitDateLabel(value) : "No date" }}
                accessibilityState={{ expanded: expanded && !disabled, disabled }} disabled={disabled}
                onPress={() => { Keyboard.dismiss(); setExpanded(open => !open); }}
                style={[dateStyles.field, disabled && styles.disabled]}>
                <Ionicons name="calendar-outline" size={22} color="#C9472C" accessible={false} />
                <Text style={[dateStyles.value, !value && dateStyles.placeholder]}>{value ? visitDateLabel(value) : "Choose a date"}</Text>
                <Ionicons name={expanded && !disabled ? "chevron-up" : "chevron-down"} size={18} color="#79665E" accessible={false} />
            </Pressable>
            {value !== null && <Pressable accessibilityRole="button" accessibilityLabel="Remove visit date" disabled={disabled}
                onPress={() => { setExpanded(false); onChange(null); }} style={[dateStyles.clear, disabled && styles.disabled]}>
                <Text style={styles.secondaryText}>Clear</Text>
            </Pressable>}
        </View>
        {expanded && !disabled && <View style={dateStyles.calendar}>
            <DateTimePicker accessibilityLabel="Visit date calendar" value={selected} mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"} themeVariant="light" accentColor="#C9472C"
                onChange={(event, date) => {
                    if (Platform.OS !== "ios") setExpanded(false);
                    if (event.type === "set" && date) select(date);
                }} />
            {Platform.OS === "ios" && <View style={dateStyles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Use today's date" style={dateStyles.action}
                    onPress={() => { select(visitDateToLocal(localToday())!); setExpanded(false); }}>
                    <Text style={styles.secondaryText}>Today</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Done choosing visit date" style={[dateStyles.action, dateStyles.done]}
                    onPress={() => { select(selected); setExpanded(false); }}>
                    <Text style={styles.primaryText}>Done</Text>
                </Pressable>
            </View>}
        </View>}
    </View>;
}

const dateStyles = StyleSheet.create({
    section: { marginBottom: 16 },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    field: { flex: 1, minWidth: 0, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12,
        backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#BFA99B", borderRadius: 12, padding: 14 },
    value: { flex: 1, color: "#2D1F1A", fontSize: 17 },
    placeholder: { color: "#79665E" },
    clear: { minHeight: 48, minWidth: 48, justifyContent: "center", alignItems: "center", padding: 8 },
    calendar: { marginTop: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E8DACE", borderRadius: 16, padding: 8 },
    actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1,
        borderColor: "#E8DACE", paddingTop: 8, marginTop: 4 },
    action: { minHeight: 48, minWidth: 80, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", borderRadius: 12 },
    done: { backgroundColor: "#C9472C" },
});
