import { backToContext, type DetailOrigin } from "@/lib/restaurant-navigation";
import SavedMapCanvas from "@/components/saved-map-canvas";
import SavedMapPanel from "@/components/saved-map-panel";
import type { MapPanelState } from "@/lib/saved-map-panel";
import { useSavedMap } from "@/hooks/use-saved-map";
import { filterMapRestaurants, groupMapRestaurants, inMapRegion, mapSourceHref, validMapCoordinate } from "@/lib/saved-map-model";
import { getMapKitSearchModule } from "@/modules/groupbite-mapkit-search";
import type { MapCanvasHandle, MapRegion, MapRestaurant } from "@/types/saved-map";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, AppState, FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SavedMapScreen({ userId, origin = "map" }: { userId: string; origin?: DetailOrigin }) {
    const router = useRouter(), insets = useSafeAreaInsets(), map = useRef<MapCanvasHandle>(null);
    const list = useRef<FlatList<MapRestaurant>>(null);
    const read = useSavedMap(userId);
    const { fontScale } = useWindowDimensions();
    const [filter, setFilter] = useState("all"), [selection, setSelection] = useState<string | null>(null);
    const [panel, setPanel] = useState<MapPanelState>("compact"), [height, setHeight] = useState(700);
    const [topHeight, setTopHeight] = useState(116);
    const [viewport, setViewport] = useState<MapRegion | null>(null);
    const camera = useRef<MapRegion | null>(null), fitRequested = useRef(false);
    const [locating, setLocating] = useState(false), [showUser, setShowUser] = useState(false), [locationMessage, setLocationMessage] = useState("");
    const [locationResult, setLocationResult] = useState<{ status: string; latitude?: number; longitude?: number } | null>(null);
    const locationGeneration = useRef(0), locationPending = useRef(false), eligible = useRef(false);
    const visibleData = useRef(read.data); visibleData.current = read.data;
    eligible.current = read.eligible;
    const all = groupMapRestaurants(read.data?.sources ?? []);
    const effectiveFilter = filter === "all" || filter === "personal" || read.data?.collections.some(g => g.id === filter) ? filter : "all";
    const restaurants = filterMapRestaurants(all, effectiveFilter);
    const mapped = restaurants.filter(r => r.coordinate), unmapped = restaurants.filter(r => !r.coordinate);
    const selected = restaurants.find(r => r.key === selection) ?? null;
    const nearby = mapped.filter(r => !viewport || inMapRegion(r.coordinate!, viewport));
    const controlsTop = insets.top + topHeight + 12;
    const expandedHeight = Math.max(180, Math.min(height * 0.61, 510, height - controlsTop - 70));
    // Navigation chrome stays compact; restaurant content keeps full text scaling.
    const headerHeight = Math.max(74, Math.ceil(38 * Math.min(fontScale, 1.4) + 27));
    const panelHeights = { collapsed: headerHeight, compact: Math.min(270 + headerHeight - 74, expandedHeight - 35), expanded: expandedHeight };
    const filterLabel = effectiveFilter === "all" ? "All Saved" : effectiveFilter === "personal" ? "My Places"
        : read.data?.collections.find(g => g.id === effectiveFilter)?.name ?? "All Saved";
    const outside = mapped.filter(r => !nearby.some(n => n.key === r.key));
    const sourcesFor = (restaurant: MapRestaurant) => [...(all.find(r => restaurant.sources.every(source => r.sources.some(s => s.key === source.key)))?.sources ?? restaurant.sources)]
        .sort((a, b) => a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "personal" ? -1 : 1);
    useEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [selection, effectiveFilter]);
    useEffect(() => { if (locationMessage) list.current?.scrollToOffset({ offset: 0, animated: false }); }, [locationMessage]);
    useEffect(() => {
        if (!read.eligible) {
            setShowUser(false); setLocationMessage("");
            // The system permission prompt temporarily makes the app inactive.
            // Retain its answer until foreground reads have been revalidated.
            if (AppState.currentState !== "inactive") {
                locationGeneration.current++; locationPending.current = false; setLocating(false); setLocationResult(null);
            }
        } else if (read.data && locationResult) {
            if (locationResult.status === "granted" && validMapCoordinate({ latitude: locationResult.latitude!, longitude: locationResult.longitude! })) {
                setShowUser(true); map.current?.focus({ latitude: locationResult.latitude!, longitude: locationResult.longitude! });
            } else {
                setPanel("compact");
                setLocationMessage(locationResult.status === "denied" ? "Location access is off. You can still browse your saved restaurants. Enable access in Settings if you want to locate yourself."
                : locationResult.status === "disabled" ? "Location Services are off. Your saved map still works."
                    : "Your location is unavailable right now. Try again, or keep browsing your saved restaurants.");
            }
            setLocationResult(null);
        }
    }, [read.eligible, read.data, locationResult]);
    useEffect(() => {
        const generation = locationGeneration;
        const gate = eligible;
        const sub = AppState.addEventListener("change", value => { if (value === "background") generation.current++; });
        return () => { generation.current++; gate.current = false; sub.remove(); };
    }, []);
    useEffect(() => {
        if (read.data && fitRequested.current) { fitRequested.current = false; map.current?.fit(); }
    }, [read.data, effectiveFilter]);
    function choose(key: string) {
        if (!eligible.current || !read.data || visibleData.current !== read.data) return;
        const restaurant = restaurants.find(r => r.key === key);
        setSelection(key); setPanel("compact");
        if (restaurant?.coordinate) map.current?.focus(restaurant.coordinate);
    }
    async function locate() {
        if (!eligible.current || locationPending.current) return;
        const generation = locationGeneration.current;
        locationPending.current = true; setLocating(true); setLocationMessage("");
        try {
            const native = getMapKitSearchModule();
            const result = await native?.requestCurrentLocation?.();
            if (generation === locationGeneration.current) setLocationResult(result ?? { status: "unavailable" });
        } catch { if (generation === locationGeneration.current) setLocationResult({ status: "unavailable" }); }
        finally { if (generation === locationGeneration.current) { locationPending.current = false; setLocating(false); } }
    }
    const button = (label: string, icon: ComponentProps<typeof Ionicons>["name"], onPress: () => void, disabled = false) =>
        <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
            style={({ pressed }) => [s.circle, pressed && s.pressed, disabled && { opacity: 0.5 }]}>
            <Ionicons name={icon} size={22} color="#C9472C" accessible={false} />
        </Pressable>;
    function card(restaurant: MapRestaurant, detail = false) {
        const sources = sourcesFor(restaurant);
        const city = restaurant.sources.find(source => source.structured?.city)?.structured?.city;
        return <View style={[s.card, detail && s.detailCard]}>
            {detail ? <><Text style={s.name}>{restaurant.name}</Text><Text style={s.address}>{restaurant.address}</Text></> :
                <Pressable accessibilityRole="button" accessibilityLabel={`Select ${restaurant.name}`} onPress={() => choose(restaurant.key)} style={({ pressed }) => [s.row, pressed && s.pressed]}>
                    <View style={[s.rowIcon, !restaurant.coordinate && s.unmappedIcon]}><Ionicons name={restaurant.coordinate ? "restaurant-outline" : "location-outline"} size={20} color="#A33720" accessible={false} /></View>
                    <View style={s.rowBody}><Text style={s.rowName}>{restaurant.name}</Text>
                        <Text style={s.address}>{city ?? restaurant.address}</Text>
                        <Text style={s.caption}>{sources.map(source => source.label).join(" · ")}</Text>
                    </View><Ionicons name="chevron-forward" size={17} color="#775644" accessible={false} />
                </Pressable>}
            {!restaurant.coordinate && <Text style={s.notice}>Not on map · No saved coordinates</Text>}
            {!detail && restaurant.coordinate && viewport && !inMapRegion(restaurant.coordinate, viewport) && <Text style={s.notice}>Outside this map area</Text>}
            {restaurant.ambiguous && <Text style={s.notice}>Saved details differ; shown separately.</Text>}
            {detail && <View style={s.sources}>
                <Text style={s.eyebrow}>SAVED COLLECTIONS · OPEN DETAILS</Text>
                {sources.map(source => {
                    const stats = source.stats;
                    const facts = [stats?.visitCount != null ? `${stats.visitCount} ${stats.visitCount === 1 ? "visit" : "visits"}` : null,
                        stats?.rating != null ? `${stats.ratingKind === "latest" ? "Latest rating" : "Avg rating"} ${Number(stats.rating.toFixed(1))}/5` : null].filter(Boolean).join(" · ");
                    return <Pressable key={source.key} accessibilityRole="button" accessibilityLabel={`Open ${restaurant.name} in ${source.label}`}
                        onPress={() => { if (eligible.current && read.data && visibleData.current === read.data) router.push(mapSourceHref(source, origin)); }} style={({ pressed }) => [s.source, pressed && s.pressed]}>
                        <Ionicons name={source.kind === "personal" ? "lock-closed-outline" : "people-outline"} size={18} color="#A33720" accessible={false} />
                        <View style={s.rowBody}><Text style={s.sourceText}>{source.label}</Text>{!!facts && <Text style={s.caption}>{facts}</Text>}</View>
                        <Ionicons name="chevron-forward" size={17} color="#A33720" accessible={false} />
                    </Pressable>;
                })}
            </View>}
        </View>;
    }
    return <View style={s.screen} onLayout={e => setHeight(e.nativeEvent.layout.height)}>
        {read.eligible && read.data && <SavedMapCanvas ref={map} restaurants={restaurants} selected={selected?.key ?? null}
            initialRegion={camera.current} showUser={showUser} padding={{ top: controlsTop + 50, bottom: panelHeights.compact + 24, left: 34, right: 60 }}
            onSelect={choose} onDismiss={() => { setSelection(null); setPanel("collapsed"); }}
            onRegion={value => { camera.current = value; setViewport(value); }} />}
        <View style={[s.top, { top: insets.top + 6 }]} pointerEvents="box-none" onLayout={e => setTopHeight(e.nativeEvent.layout.height)}>
            <View style={s.heading}>
                {button("Back", "chevron-back", () => backToContext(router, origin === "home" ? "/" : "/my-places"))}
                <Text numberOfLines={1} maxFontSizeMultiplier={1.4} adjustsFontSizeToFit style={s.title}>Saved Map</Text>
                {button("Refresh saved map", "refresh", read.refresh, read.loading)}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
                {[{ id: "all", name: "All Saved" }, { id: "personal", name: "My Places" }, ...[...(read.data?.collections ?? [])].sort((a, b) => a.name.localeCompare(b.name))].map(item =>
                    <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: effectiveFilter === item.id }}
                        onPress={() => { setFilter(item.id); setSelection(null); setPanel("compact"); fitRequested.current = true; }}
                        style={[s.filter, effectiveFilter === item.id && s.activeFilter]}>
                        <Text style={[s.filterText, effectiveFilter === item.id && s.activeFilterText]}>{item.name}</Text>
                    </Pressable>)}
            </ScrollView>
        </View>
        {read.eligible && read.data && <View style={[s.controls, { top: controlsTop, flexDirection: "row" }]}>
            {button(locating ? "Locating you" : "Current location", "locate-outline", () => { void locate(); }, locating)}
            {button("Zoom in", "add", () => map.current?.zoom(1))}
            {button("Zoom out", "remove", () => map.current?.zoom(-1))}
            {button("Show all saved restaurants", "scan-outline", () => map.current?.fit(), !mapped.length)}
        </View>}
        {read.loading && <View style={s.center}><ActivityIndicator color="#C9472C" /><Text style={s.address}>Loading saved restaurants…</Text></View>}
        {!!read.error && <View style={s.center}><Text accessibilityRole="alert" style={s.address}>{read.error}</Text></View>}
        {read.eligible && read.data && <SavedMapPanel state={panel} onChange={setPanel} heights={panelHeights}
            title={selected ? "Restaurant details" : restaurants.length ? "Your saved restaurants" : "No saved restaurants"}
            subtitle={selected ? `Saved in ${sourcesFor(selected).length} ${sourcesFor(selected).length === 1 ? "collection" : "collections"}`
                : `${filterLabel} · ${mapped.length} mapped · ${unmapped.length} unmapped`}>
            <FlatList ref={list} data={selected && panel !== "expanded" ? [] : [...nearby, ...outside, ...unmapped].filter(r => r.key !== selected?.key)}
                keyExtractor={item => item.key} renderItem={({ item }) => card(item)} contentContainerStyle={s.list}
                ListHeaderComponent={<>{locationMessage !== "" && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss location message" onPress={() => setLocationMessage("")} style={s.locationMessage}>
                    <Text style={s.address}>{locationMessage}</Text><Text style={s.sourceText}>Dismiss</Text></Pressable>}
                    {selected ? <>{card(selected, true)}{panel === "expanded" && <Text style={s.listHeading}>More saved restaurants</Text>}</> :
                    <Text style={s.guidance}>{mapped.length ? `${nearby.length} mapped ${nearby.length === 1 ? "restaurant" : "restaurants"} in this map area. Tap a row to focus.`
                        : restaurants.length ? "These saved addresses need coordinates before they can appear on the map."
                            : "Use Add to save a restaurant to this collection."}</Text>}</>}
                ListEmptyComponent={!selected && mapped.length === 0 && restaurants.length === 0 ? <Text style={s.guidance}>Your personal and group places will appear here.</Text> : null} />
        </SavedMapPanel>}

    </View>;
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: "#FFF8F0", overflow: "hidden" }, top: { position: "absolute", left: 12, right: 12 },
    heading: { flexDirection: "row", alignItems: "center", gap: 10 }, title: { flex: 1, fontSize: 22, fontWeight: "700", color: "#302018",
        backgroundColor: "#FFFAF5", borderWidth: 1, borderColor: "#C5A994", paddingHorizontal: 15, paddingVertical: 9, borderRadius: 18, overflow: "hidden" },
    circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFFAF5", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#BFA28D", shadowColor: "#302018", shadowOpacity: 0.25, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
    pressed: { backgroundColor: "#F6DEC9" }, filters: { gap: 8, paddingVertical: 12 },
    filter: { paddingHorizontal: 16, minHeight: 44, justifyContent: "center", borderRadius: 22, backgroundColor: "#FFFAF5", borderWidth: 1.5, borderColor: "#BFA28D", shadowColor: "#302018", shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
    activeFilter: { backgroundColor: "#AF391F", borderColor: "#8C2B16" }, filterText: { fontSize: 14, fontWeight: "600", color: "#483024" }, activeFilterText: { color: "#FFFFFF" },
    controls: { position: "absolute", right: 12, gap: 8 }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 36 },
    card: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#DCC8B9", paddingHorizontal: 17, paddingVertical: 11 },
    detailCard: { paddingTop: 14, paddingBottom: 16 },
    name: { fontSize: 22, fontWeight: "700", color: "#302018", marginBottom: 5 }, address: { color: "#655047", fontSize: 14, lineHeight: 20 },
    row: { flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 12, minHeight: 65 }, rowBody: { flex: 1, gap: 3 },
    rowIcon: { width: 39, height: 39, borderRadius: 14, backgroundColor: "#FFE5CF", alignItems: "center", justifyContent: "center" },
    unmappedIcon: { backgroundColor: "#EFE3D8" }, rowName: { fontSize: 16, fontWeight: "600", color: "#302018" },
    caption: { color: "#6D5141", fontSize: 12, lineHeight: 17 },
    sources: { gap: 8, paddingTop: 16 }, source: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14,
        backgroundColor: "#F8E8D9", borderWidth: 1, borderColor: "#DFC4AC", paddingHorizontal: 12, paddingVertical: 10, minHeight: 50 },
    sourceText: { color: "#95301C", fontWeight: "600", fontSize: 14 }, eyebrow: { color: "#655047", fontSize: 11, letterSpacing: 0.8, fontWeight: "700", marginBottom: 2 },
    notice: { color: "#75503C", fontSize: 12, lineHeight: 18, marginTop: 6 },
    list: { paddingBottom: 16 }, guidance: { color: "#655047", fontSize: 13, lineHeight: 19, paddingHorizontal: 17, paddingTop: 12, paddingBottom: 5 },
    listHeading: { fontSize: 14, fontWeight: "700", color: "#655047", paddingHorizontal: 17, paddingTop: 16, paddingBottom: 2 },
    locationMessage: { margin: 12, padding: 14, borderRadius: 16, backgroundColor: "#F8E8D9", borderWidth: 1, borderColor: "#C5A994", gap: 8 },
});
