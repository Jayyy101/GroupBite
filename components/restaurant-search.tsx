import { appleSearchAvailable, appleSearchErrorMessage, completeAppleSearch, resolveAppleSuggestion,
    searchApplePlaces, resetAppleSearch, type AppleSearchLocation, type AppleSearchSuggestion } from "@/lib/apple-map-search";
import { backendStyles as styles } from "@/styles/backend";
import type { AddRestaurant } from "@/types/database";
import { useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Pressable, Text, TextInput, View } from "react-native";

// Reuse MapKit's exact candidates and DEBUG boundary. Only presentation changes:
// the page owns scrolling; result cards don't embed maps or nested scroll views.
export function RestaurantSearch({ onSelect, disabled = false, selectionHint = "Select this restaurant, then choose where to save your visit." }: {
    onSelect: (restaurant: AddRestaurant) => void; disabled?: boolean; selectionHint?: string;
}) {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<AppleSearchSuggestion[]>([]);
    const [candidates, setCandidates] = useState<AppleSearchLocation[]>([]);
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [available] = useState(appleSearchAvailable);
    const alive = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const locked = useRef(disabled); locked.current = disabled;
    const choose = useRef(onSelect); choose.current = onSelect;
    const visibleGeneration = generation.current;
    function cancel(reset = true) {
        generation.current++; clearTimeout(debounce.current); controller.current?.abort(); controller.current = null;
        if (reset) resetAppleSearch();
    }
    useEffect(() => {
        alive.current = true;
        const subscription = AppState.addEventListener("change", state => {
            if (state !== "active") { cancel(); setQuery(""); setSuggestions([]); setCandidates([]); setBusy(false); }
        });
        return () => { alive.current = false; subscription.remove(); cancel(); };
    }, []);
    useEffect(() => {
        if (disabled) { cancel(); setSuggestions([]); setCandidates([]); setBusy(false); }
    }, [disabled]);
    async function search(mode: "complete" | "search" | "resolve", text: string) {
        if (!alive.current || locked.current || AppState.currentState !== "active") return;
        // Resolution must retain native cached suggestion handles.
        cancel(mode !== "resolve"); const epoch = generation.current, request = new AbortController(); controller.current = request;
        setBusy(true); setError(""); setSuggestions([]); setCandidates([]);
        try {
            const result = mode === "complete" ? await completeAppleSearch(text, "business", request.signal)
                : mode === "resolve" ? await resolveAppleSuggestion(text, request.signal) : await searchApplePlaces(text, "business", request.signal);
            if (!alive.current || locked.current || epoch !== generation.current || request.signal.aborted) return;
            if (mode === "complete") setSuggestions(result as AppleSearchSuggestion[]);
            else setCandidates(result as AppleSearchLocation[]);
            if (!result.length) setError("No restaurants found. Try a name and city, or enter a restaurant manually.");
        } catch (error) {
            if (alive.current && !locked.current && epoch === generation.current && !request.signal.aborted) setError(appleSearchErrorMessage(error));
        } finally {
            if (alive.current && epoch === generation.current) { controller.current = null; setBusy(false); }
        }
    }
    useEffect(() => {
        if (!available || disabled || query.trim().length < 3) return;
        const timer = setTimeout(() => { void search("complete", query); }, 400);
        debounce.current = timer;
        return () => clearTimeout(timer);
        // Query edits alone schedule autocomplete; resolution and explicit search do not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, available, disabled]);
    return <View>
        <Text style={styles.label}>Find a restaurant</Text>
        {!available ? <Text style={styles.message}>{__DEV__
            ? "Apple Maps search needs the local iOS debug development build, with GroupBiteMapKitSearch included. Expo Go cannot run it. Use recent restaurants or manual entry here."
            : "Use a recently saved restaurant or enter one manually."}</Text> : <>
            <TextInput accessibilityLabel="Search restaurants" style={styles.input} value={query} editable={!disabled} maxLength={200}
                placeholder="Restaurant name and city" autoCorrect={false} returnKeyType="search"
                onChangeText={value => { if (!alive.current || locked.current) return; cancel(); setQuery(value); setSuggestions([]); setCandidates([]); setBusy(false); setError(""); }}
                onSubmitEditing={() => { Keyboard.dismiss(); void search("search", query); }} />
            <Pressable accessibilityRole="button" disabled={disabled || busy || query.trim().length < 3} onPress={() => {
                Keyboard.dismiss(); void search("search", query);
            }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Search Apple Maps</Text></Pressable>
            {busy && <Text style={styles.message}>Searching Apple Maps...</Text>}
            {suggestions.length > 0 && <Text style={styles.label}>Suggestions — tap to see restaurants</Text>}
            {suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" disabled={disabled || busy}
                onPress={() => { if (visibleGeneration === generation.current) void search("resolve", item.id); }} style={styles.card}>
                <Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.message}>{item.subtitle}</Text>
            </Pressable>)}
            {candidates.length > 0 && <Text style={styles.label}>Choose a restaurant</Text>}
            {candidates.map(item => <Pressable key={item.id} accessibilityRole="button" disabled={disabled || busy}
                    style={[styles.card, styles.cardBody]} accessibilityHint={selectionHint}
                    accessibilityLabel={`Choose restaurant: ${item.name}, ${item.address}`} onPress={() => {
                        if (!alive.current || locked.current || AppState.currentState !== "active" || visibleGeneration !== generation.current) return;
                        if (Array.from(item.name).length > 100 || Array.from(item.address).length > 300) {
                            setError("This result needs a shorter name or address. Enter the restaurant manually."); return;
                        }
                        Keyboard.dismiss(); choose.current({ name: item.name, address: item.address, cuisine: null, apple_place_id: item.placeId ?? null,
                            mapkit_point: Object.freeze({ name: item.name, address: item.address, latitude: item.latitude, longitude: item.longitude }) });
                    }}><Text style={styles.cardTitle}>{item.name}</Text><Text style={[styles.message, styles.cardMessage]}>{item.address}</Text>
                    <Text style={[styles.secondaryText, styles.cardMessage]}>Use this restaurant</Text></Pressable>)}
        </>}
        {error !== "" && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>;
}
