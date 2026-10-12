import DevMapKitPreview from "@/components/dev-mapkit-preview";
import { PersonalAccess } from "@/components/personal-access";
import { appleSearchAvailable, appleSearchErrorMessage, CHIPOTLE_COMPARISON_ID, CHIPOTLE_SEARCH, completeAppleSearch,
    pinDistanceMeters, resetAppleSearch, resolveAppleSuggestion, searchApplePlaces, type AppleSearchLocation, type AppleSearchMode,
    type AppleSearchSuggestion } from "@/lib/apple-map-search";
import { listPersonalMapPins, personalMapErrorMessage, type PersonalMapPin } from "@/lib/personal-map";
import { backendStyles as styles } from "@/styles/backend";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function DevAppleSearchScreen() {
    if (!__DEV__ || Platform.OS !== "ios") return <Redirect href="/" />;
    return <PersonalAccess title="Apple Maps Search Preview">{userId => <SearchPreview key={userId} userId={userId} />}</PersonalAccess>;
}

function SearchPreview({ userId }: { userId: string }) {
    const router = useRouter();
    const [available] = useState(appleSearchAvailable);
    const [mode, setMode] = useState<AppleSearchMode>("business"), [query, setQuery] = useState("");
    const [edits, setEdits] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [action, setAction] = useState<"complete" | "search">("complete");
    const [finished, setFinished] = useState<"complete" | "search" | "resolve" | null>(null);
    const [loadingText, setLoadingText] = useState("");
    const [suggestions, setSuggestions] = useState<AppleSearchSuggestion[]>([]), [candidates, setCandidates] = useState<AppleSearchLocation[]>([]);
    const [selected, setSelected] = useState<AppleSearchLocation | null>(null), [confirmed, setConfirmed] = useState(false);
    const [saved, setSaved] = useState<PersonalMapPin | null>(null), [savedLoading, setSavedLoading] = useState(true), [savedError, setSavedError] = useState("");
    const alive = useRef(true), resolving = useRef<AbortController | null>(null), generation = useRef(0);
    const visibleGeneration = generation.current;

    useEffect(() => {
        alive.current = true;
        let active = true;
        const controller = new AbortController();
        listPersonalMapPins(userId, controller.signal).then(pins => { if (active) setSaved(pins.find(pin => pin.id === CHIPOTLE_COMPARISON_ID) ?? null); })
            .catch(error => { if (active) setSavedError(personalMapErrorMessage(error)); })
            .finally(() => { if (active) setSavedLoading(false); });
        return () => { active = false; alive.current = false; controller.abort(); resolving.current?.abort(); resetAppleSearch(); };
    }, [userId]);

    useEffect(() => {
        if (!available || edits === 0 || query.trim().length < 3) return;
        let active = true;
        const requestGeneration = generation.current;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setBusy(true);
            const pending = action === "search" ? searchApplePlaces(query, mode, controller.signal) : completeAppleSearch(query, mode, controller.signal);
            pending.then(items => {
                if (!active || requestGeneration !== generation.current) return;
                if (action === "search") setCandidates(items as AppleSearchLocation[]);
                else setSuggestions(items as AppleSearchSuggestion[]);
                setFinished(action);
            })
                .catch(error => { if (active && requestGeneration === generation.current) setError(appleSearchErrorMessage(error)); })
                .finally(() => { if (active && requestGeneration === generation.current) setBusy(false); });
        }, 400);
        return () => { active = false; clearTimeout(timer); controller.abort(); };
    }, [available, edits, query, mode, action]);

    function edit(value: string, nextMode = mode, nextAction: "complete" | "search" = "complete") {
        if (!alive.current) return;
        generation.current++;
        resolving.current?.abort(); resolving.current = null; resetAppleSearch();
        setQuery(value); setMode(nextMode); setAction(nextAction); setEdits(value => value + 1);
        setSuggestions([]); setCandidates([]); setSelected(null); setConfirmed(false); setError(""); setFinished(null);
        setLoadingText(nextAction === "search" ? "Searching Apple locations..." : "Loading Apple suggestions...");
        setBusy(available && value.trim().length >= 3);
    }
    async function chooseSuggestion(item: AppleSearchSuggestion) {
        if (!alive.current || visibleGeneration !== generation.current || resolving.current || !suggestions.some(value => value.id === item.id)) return;
        const controller = new AbortController(); resolving.current = controller;
        setBusy(true); setLoadingText("Resolving the selected Apple suggestion...");
        setCandidates([]); setSelected(null); setConfirmed(false); setError(""); setFinished(null);
        try {
            const locations = await resolveAppleSuggestion(item.id, controller.signal);
            if (!alive.current || controller.signal.aborted || visibleGeneration !== generation.current) return;
            setCandidates(locations); setSuggestions([]); setFinished("resolve");
        } catch (error) { if (alive.current && !controller.signal.aborted && visibleGeneration === generation.current) setError(appleSearchErrorMessage(error)); }
        finally { if (alive.current && resolving.current === controller) { resolving.current = null; setBusy(false); } }
    }

    function savedStatus() {
        return savedLoading ? <Text style={styles.message}>Loading saved comparison pin...</Text> : savedError !== "" ? <Text style={styles.error}>{savedError}</Text>
            : !saved ? <Text style={styles.message}>No saved Chipotle comparison pin is available for this account.</Text> : null;
    }

    if (selected) return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <View style={layout.mapHeader}>
            <Pressable accessibilityRole="button" style={layout.returnButton} onPress={() => {
                if (!alive.current || visibleGeneration !== generation.current) return;
                setSelected(null); setConfirmed(false);
            }}>
                <Text style={styles.secondaryText}>Return to search</Text></Pressable>
            <Text style={layout.legend}>Blue: Apple restaurant/location · Red: saved Geoapify</Text>
        </View>
        <DevMapKitPreview key={`${selected.id}:${saved?.id ?? "none"}`} selection={selected} saved={saved} />
        <ScrollView style={layout.details} contentContainerStyle={layout.detailsContent}>
            <Text style={styles.cardTitle}>Apple: {selected.name}</Text>
            <Text style={layout.detailText}>{selected.address}{"\n"}{selected.latitude}, {selected.longitude}</Text>
            {savedStatus()}
            {saved && <>
                <Text style={styles.cardTitle}>Saved Geoapify: {saved.name}</Text>
                <Text style={layout.detailText}>{saved.address}{"\n"}{saved.latitude}, {saved.longitude}</Text>
                <Text style={layout.detailText}>The pins differ by approximately {pinDistanceMeters(selected, saved)} meters. This does not prove either pin is correct.</Text>
            </>}
            <Pressable accessibilityRole="button" style={layout.returnButton} onPress={() => {
                if (alive.current && visibleGeneration === generation.current) setConfirmed(true);
            }}>
                <Text style={styles.secondaryText}>Looks correct (preview only)</Text></Pressable>
            <Text style={layout.detailText}>{confirmed ? "Preview confirmed. Nothing was saved; Apple results are not signed attachment receipts." : "Development preview only. Nothing is saved or changed."}</Text>
        </ScrollView>
    </SafeAreaView>;

    return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" style={[styles.secondaryButton, styles.backButton]}
            onPress={() => router.canGoBack() ? router.back() : router.replace("/my-places")}><Text style={styles.secondaryText}>Back</Text></Pressable>
        <Text style={styles.title}>Apple Maps Search Preview</Text>
        <Text style={styles.message}>Development only. Check the restaurant name, address and pin. Nothing here saves or changes a place.</Text>
        {!available && <Text style={styles.error}>Requires the local iOS debug build. Expo Go does not include Apple search.</Text>}
        <Pressable accessibilityRole="button" disabled={!available || busy} style={styles.secondaryButton} onPress={() => edit(CHIPOTLE_SEARCH, "business", "search")}>
            <Text style={styles.secondaryText}>Search Chipotle in Apple Maps</Text></Pressable>
        {(["business", "address"] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: mode === value }}
            disabled={!available} style={styles.secondaryButton} onPress={() => edit(query, value)}>
            <Text style={styles.secondaryText}>{value === "business" ? "Businesses" : "Addresses"}</Text></Pressable>)}
        <TextInput accessibilityLabel="Apple Maps search" style={styles.input} editable={available} maxLength={200} value={query}
            placeholder={mode === "business" ? "Restaurant or business name and city" : "Street address and city"}
            onChangeText={value => { if (value !== query) edit(value); }} autoCorrect={false} returnKeyType="search"
            onSubmitEditing={() => { Keyboard.dismiss(); if (available && query.trim().length >= 3 && !(busy && action === "search")) edit(query, mode, "search"); }} />
        <Pressable accessibilityRole="button" disabled={!available || query.trim().length < 3 || (busy && action === "search")}
            style={styles.secondaryButton} onPress={() => { Keyboard.dismiss(); edit(query, mode, "search"); }}>
            <Text style={styles.secondaryText}>Search places</Text></Pressable>
        {busy && <Text accessibilityLiveRegion="polite" style={styles.message}>{loadingText}</Text>}
        {error !== "" && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Select Apple suggestion: ${item.title}`}
            disabled={busy} style={styles.card} onPress={() => chooseSuggestion(item)}>
            <Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.message}>{item.subtitle}</Text></Pressable>)}
        {!busy && finished !== null && suggestions.length === 0 && candidates.length === 0 && error === "" &&
            <Text accessibilityLiveRegion="polite" style={styles.message}>{finished === "complete"
                ? "No Apple suggestions for this text. Tap Search places or add a city/address."
                : "No matching Apple locations. Try a more specific name and address."}</Text>}
        {candidates.length > 0 && <Text style={styles.message}>Select an Apple location to open the comparison map. Check its address first.</Text>}
        {candidates.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Preview Apple location: ${item.name}`}
            style={styles.card} onPress={() => { if (!alive.current || visibleGeneration !== generation.current || !candidates.some(value => value.id === item.id)) return;
                setSelected(item); setConfirmed(false); Keyboard.dismiss(); }}>
            <Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.message}>{item.address}</Text></Pressable>)}
        {savedStatus()}
        {saved && <Text style={styles.message}>Your saved comparison pin will appear in red after you select an Apple location.</Text>}
    </ScrollView>;
}

const layout = StyleSheet.create({
    mapHeader: { paddingHorizontal: 16, paddingVertical: 8 },
    returnButton: { minHeight: 44, justifyContent: "center" },
    legend: { color: "#2D1F1A", fontSize: 14 },
    details: { maxHeight: "36%", flexGrow: 0 },
    detailsContent: { padding: 16 },
    detailText: { color: "#79665E", fontSize: 14, lineHeight: 20, marginBottom: 8 },
});
