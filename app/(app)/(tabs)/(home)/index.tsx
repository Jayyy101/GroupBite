import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenScaffold } from "@/components/screen-scaffold";
import SavedMapShortcut from "@/components/saved-map-shortcut";
import { useHomeDashboard } from "@/hooks/use-home-dashboard";
import { destinationHref, groupHref } from "@/lib/restaurant-navigation";
import { backendStyles } from "@/styles/backend";
import { useRef, useState } from "react";
import type { CollectionMetric } from "@/types/collection-statistics";
import type { DashboardVisit } from "@/types/home-dashboard";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View, Platform, ScrollView, useWindowDimensions } from "react-native";

function SummaryCard({ title, qualifier, value, icon, onPress, wide }: {
    title: string; qualifier: string; value: CollectionMetric; icon: React.ComponentProps<typeof Ionicons>["name"];
    onPress: () => void; wide: boolean;
}) {
    const identifiedCities = value.reason === "city" && value.knownCount !== null;
    const description = value.status === "ready" ? value.value!.toLocaleString()
        : value.status === "loading" ? "Loading" : identifiedCities ? `${value.knownCount} identified` : "Unavailable";
    const detail = value.reason === "history" ? "Older records have no shared visit identity."
        : value.reason === "backend" ? "Unique counting awaits a backend update."
        : value.reason === "city" ? `${value.unresolvedRecords} saved ${value.unresolvedRecords === 1 ? "entry needs" : "entries need"} city details.`
        : value.reason === "identity" ? "Some saved entries need clearer location details."
        : value.status === "error" || value.reason === "limit" ? "Refresh to check this total." : qualifier;
    return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${qualifier}, ${description}`}
        accessibilityHint={title === "Your visits" ? "Browse recent destination saves." : title === "Groups joined" ? "View your groups." : "Browse saved restaurant locations."}
        accessibilityState={{ disabled: value.status === "loading" }} disabled={value.status === "loading"}
        onPress={onPress} style={({ pressed }) => [styles.summaryCard, { width: wide ? "100%" : "48.5%" }, pressed && styles.pressed]}>
        <View style={styles.metricHeading}>
            <Ionicons name={icon} size={20} color="#C9472C" accessible={false} />
            <Text style={styles.summaryTitle}>{title}</Text>
        </View>
        <Text style={styles.summaryValue}>{value.status === "ready" ? description : value.status === "loading" ? "…" : identifiedCities ? value.knownCount : "—"}
            {identifiedCities && <Text style={styles.identified}> identified</Text>}</Text>
        <Text style={styles.summaryQualifier}>{detail}</Text>
    </Pressable>;
}

function LoadingRows({ label }: { label: string }) {
    return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
        <Text style={styles.caption}>{label}</Text>
        <View accessible={false} style={styles.placeholder} />
        <View accessible={false} style={[styles.placeholder, styles.shortPlaceholder]} />
    </View>;
}

function visitDate(visit: DashboardVisit) {
    return visit.visited_on === null ? "Date not recorded" : new Date(`${visit.visited_on}T00:00:00Z`)
        .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function HomeScreen() {
    const router = useRouter();
    const dashboard = useHomeDashboard({ includeCollections: true });
    const [showMore, setShowMore] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const activityY = useRef(0);
    const { width, fontScale } = useWindowDimensions();
    const wideCards = width < 360 || fontScale > 1.4;
    const openMap = () => __DEV__ && Platform.OS === "ios"
        ? router.push("/home/saved-map", { withAnchor: true }) : router.navigate("/my-places");
    const loading = dashboard.status === "loading";
    const { recent, groups, collectionStatistics: statistics } = dashboard;

    return <ScreenScaffold scrollRef={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.header}>
            <Text style={styles.welcome}>Welcome back!</Text>
            <Text accessibilityRole="header" style={styles.title}>Your food memories</Text>
            <Text style={styles.subtitle}>Your own favorites, and memories with friends.</Text>
        </View>

        <View style={styles.sectionHeading}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>At a glance</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh dashboard"
                accessibilityState={{ disabled: loading, busy: loading }} disabled={loading} onPress={dashboard.refresh}
                style={({ pressed }) => [styles.textAction, pressed && styles.pressed, loading && backendStyles.disabled]}>
                <Ionicons name="refresh-outline" size={18} color="#C9472C" accessible={false} />
                <Text style={styles.actionText}>{loading ? "Refreshing…" : "Refresh"}</Text>
            </Pressable>
        </View>
        {statistics && <View style={styles.summaryRow}>
            <SummaryCard title="Places saved" qualifier="Across your collections" value={statistics.placesSaved} icon="restaurant-outline" wide={wideCards} onPress={openMap} />
            <SummaryCard title="Your visits" qualifier="Dining occasions you recorded" value={statistics.yourVisits} icon="time-outline" wide={wideCards} onPress={() => { setShowMore(true); scrollRef.current?.scrollTo({ y: activityY.current, animated: true }); }} />
            <SummaryCard title="Cities explored" qualifier="From saved restaurant locations" value={statistics.citiesExplored} icon="location-outline" wide={wideCards} onPress={openMap} />
            <SummaryCard title="Groups joined" qualifier="Including groups you own" value={statistics.groupsJoined} icon="people-outline" wide={wideCards} onPress={() => router.navigate("/groups")} />
        </View>}
        {statistics && Object.values(statistics).some(metric => metric.status === "error" || metric.reason === "limit") &&
            <Text accessibilityLiveRegion="polite" style={styles.notice}>Some totals are unavailable. Refresh to try again.</Text>}
        <Text style={styles.coverage}>Saved places span My Places and your current groups. Visit totals count only occasions you recorded.</Text>

        <SavedMapShortcut />

        <View style={styles.section} onLayout={event => { activityY.current = event.nativeEvent.layout.y; }}>
            <View style={styles.sectionHeading}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>Recent saves</Text>
            </View>
            <Text style={styles.sectionDescription}>Latest destination saves. One occasion can appear in several collections.</Text>
            {recent.status === "loading" ? <LoadingRows label="Loading recent visits…" /> : <>
                {recent.status === "error" && <Text accessibilityLiveRegion="polite" style={styles.notice}>
                    Recent saves are unavailable. Refresh to try again.</Text>}
                {recent.status === "partial" && <Text accessibilityLiveRegion="polite" style={styles.notice}>
                    {recent.groupError ? "Recent activity is incomplete: group visits couldn’t load." : "Recent activity is incomplete: personal visits couldn’t load."}</Text>}
                {recent.status === "ready" && recent.entries.length === 0 && <Text style={styles.empty}>
                    No visits yet. Your personal and group memories will appear here.</Text>}
                {recent.entries.slice(0, showMore ? 5 : 2).map(visit => {
                    const personal = visit.kind === "personal";
                    const destination = personal ? "My Places · Private" : `Group · ${visit.groupName}`;
                    const date = visitDate(visit);
                    return <Pressable key={`${visit.kind}:${visit.visitId}`} accessibilityRole="button"
                        accessibilityLabel={`Open ${visit.name}, ${destination}, ${date}, restaurant history`}
                        onPress={() => router.push(destinationHref({ destination_kind: visit.kind,
                            group_id: visit.kind === "group" ? visit.groupId : null, entry_id: visit.entryId,
                            visit_id: visit.visitId, available: true }, "home"), { withAnchor: true })}
                        style={({ pressed }) => [styles.visitCard, pressed && styles.pressed]}>
                        <View style={styles.cardBody}>
                            <View style={[styles.destination, personal ? styles.privateDestination : styles.groupDestination]}>
                                <Ionicons name={personal ? "lock-closed-outline" : "people-outline"} size={14}
                                    color={personal ? "#79665E" : "#A83D25"} accessible={false} importantForAccessibility="no" />
                                <Text style={[styles.destinationText, !personal && styles.groupDestinationText]}>{destination}</Text>
                            </View>
                            <Text style={styles.cardTitle}>{visit.name}</Text>
                            <Text style={styles.caption}>{date}</Text>
                            {personal && visit.origin === "legacy" && <Text style={styles.caption}>Imported saved memory</Text>}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#79665E" accessible={false} importantForAccessibility="no" />
                    </Pressable>;
                })}
                {recent.entries.length > 2 && <Pressable accessibilityRole="button" accessibilityLabel={showMore ? "Show fewer recent saves" : "See more recent saves"}
                    onPress={() => setShowMore(value => !value)} style={({ pressed }) => [styles.moreAction, pressed && styles.pressed]}>
                    <Text style={styles.actionText}>{showMore ? "Show less" : "See more"}</Text>
                    <Ionicons name={showMore ? "chevron-up" : "chevron-down"} size={16} color="#C9472C" accessible={false} />
                </Pressable>}
            </>}
        </View>

        <View style={styles.section}>
            <View style={styles.sectionHeading}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>Your groups</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="View all groups" onPress={() => router.navigate("/groups")}
                    style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                    <Text style={styles.actionText}>View all</Text>
                    <Ionicons name="chevron-forward" size={16} color="#C9472C" accessible={false} importantForAccessibility="no" />
                </Pressable>
            </View>
            {groups.status === "loading" ? <LoadingRows label="Loading your groups…" /> : groups.status === "error" ?
                <Text accessibilityLiveRegion="polite" style={styles.notice}>Your groups are unavailable. Refresh to check access.</Text> : <>
                    {groups.data.length === 0 && <Text style={styles.empty}>No groups yet. Shared memories start in Groups.</Text>}
                    {groups.data.map(group => <Pressable key={`${group.id}:${group.membershipId}`} accessibilityRole="button"
                        accessibilityLabel={`Open group ${group.name}, ${group.role}`}
                        onPress={() => router.push(groupHref(group.id, "home"), { withAnchor: true })}
                        style={({ pressed }) => [styles.groupCard, pressed && styles.pressed]}>
                        <Ionicons name="people-outline" size={22} color="#C9472C" accessible={false} importantForAccessibility="no" />
                        <View style={styles.cardBody}>
                            <Text style={styles.cardTitle}>{group.name}</Text>
                            <Text style={styles.caption}>{group.role}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#79665E" accessible={false} importantForAccessibility="no" />
                    </Pressable>)}
                </>}
        </View>
    </ScreenScaffold>;
}

const styles = StyleSheet.create({
    content: { paddingTop: 24, paddingBottom: 32, gap: 24 },
    header: { gap: 8 },
    welcome: { color: "#C9472C", fontSize: 17, fontWeight: "600" },
    title: { color: "#2D1F1A", fontSize: 32, fontWeight: "700" },
    subtitle: { color: "#79665E", fontSize: 16, lineHeight: 24 },
    summaryRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12, alignItems: "stretch", marginTop: -12 },
    summaryCard: { minWidth: 0, backgroundColor: "#FFF0E8", borderWidth: 1, borderColor: "#E8DACE",
        borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14, gap: 8, minHeight: 150 },
    summaryValue: { color: "#2D1F1A", fontSize: 30, fontWeight: "700", fontVariant: ["tabular-nums"] },
    summaryTitle: { color: "#2D1F1A", fontSize: 15, fontWeight: "600", flexShrink: 1 },
    summaryQualifier: { color: "#79665E", fontSize: 13, lineHeight: 19 },
    metricHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
    identified: { color: "#79665E", fontSize: 13, fontWeight: "500" },
    coverage: { color: "#79665E", fontSize: 13, lineHeight: 19, marginTop: -12 },
    moreAction: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 10 },
    unavailable: { color: "#B42318", fontSize: 12 },
    section: { gap: 10 },
    sectionHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 12 },
    sectionTitle: { flexGrow: 1, flexShrink: 1, color: "#2D1F1A", fontSize: 21, fontWeight: "700" },
    sectionDescription: { color: "#79665E", fontSize: 14, lineHeight: 21, marginBottom: 2 },
    textAction: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
        minHeight: 44, minWidth: 44, paddingHorizontal: 6, paddingVertical: 8, borderRadius: 10 },
    actionText: { color: "#C9472C", fontSize: 15, fontWeight: "600", flexShrink: 1 },
    visitCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF",
        borderWidth: 1, borderColor: "#E8DACE", borderRadius: 16, padding: 16, minHeight: 88 },
    groupCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF",
        borderWidth: 1, borderColor: "#E8DACE", borderRadius: 16, padding: 16, minHeight: 76 },
    cardBody: { flex: 1, minWidth: 0, gap: 6 },
    cardTitle: { color: "#2D1F1A", fontSize: 17, fontWeight: "600" },
    caption: { color: "#79665E", fontSize: 14, lineHeight: 21 },
    destination: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%",
        gap: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
    privateDestination: { backgroundColor: "#F6EDE3" },
    groupDestination: { backgroundColor: "#FFF0E8" },
    destinationText: { flexShrink: 1, color: "#79665E", fontSize: 13, fontWeight: "500" },
    groupDestinationText: { color: "#A83D25" },
    empty: { color: "#79665E", fontSize: 15, lineHeight: 23, paddingVertical: 8 },
    notice: { color: "#B42318", fontSize: 14, lineHeight: 22 },
    loading: { paddingVertical: 8, gap: 12 },
    placeholder: { height: 12, borderRadius: 6, backgroundColor: "#E8DACE", width: "85%" },
    shortPlaceholder: { width: "55%" },
    pressed: { backgroundColor: "#F3E7DC" },
});
