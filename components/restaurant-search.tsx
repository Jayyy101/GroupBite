import { appleSearchAvailable, appleSearchErrorMessage, completeAppleSearch, resolveAppleSuggestion,
    searchApplePlaces, resetAppleSearch, type AppleSearchLocation, type AppleSearchSuggestion } from "@/lib/apple-map-search";
import { backendStyles as styles } from "@/styles/backend";
import type { AddRestaurant } from "@/types/database";
import { newSearchDiagnosticScope, searchDiagnosticsEnabled, traceSearch } from "@/lib/search-diagnostics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AppState, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type SearchRequestMode = "complete" | "search" | "resolve";

// Reuse MapKit's exact candidates and DEBUG boundary.
// Full results stay in the page scroll. Add can opt into a bounded, connected
// autocomplete list; other consumers retain the original presentation.
export function RestaurantSearch({ onSelect, disabled = false, selectionHint = "Select this restaurant, then choose where to save your visit.",
    searchLabel = "Search Apple Maps", primarySearch = false, connectedAutocomplete = false, dismissSuggestionsRef, children }: {
    onSelect: (restaurant: AddRestaurant) => void; disabled?: boolean; selectionHint?: string; children?: ReactNode;
    searchLabel?: string; primarySearch?: boolean;
    connectedAutocomplete?: boolean; dismissSuggestionsRef?: RefObject<(() => void) | null>;
}) {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<AppleSearchSuggestion[]>([]);
    const [candidates, setCandidates] = useState<AppleSearchLocation[]>([]);
    const [requestMode, setRequestMode] = useState<SearchRequestMode | null>(null), [error, setError] = useState("");
    const busy = requestMode !== null;
    const [available] = useState(appleSearchAvailable);
    const [traceScope] = useState(newSearchDiagnosticScope);
    const [suggestionsOpen, setSuggestionsOpen] = useState(false);
    const alive = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const activeMode = useRef<SearchRequestMode | null>(null);
    const locked = useRef(disabled); locked.current = disabled;
    const choose = useRef(onSelect); choose.current = onSelect;
    const visibleGeneration = generation.current;
    const dropdownVisible = connectedAutocomplete && suggestionsOpen && suggestions.length > 0 && !busy && !disabled && !candidates.length;
    const trace = (event: string, data: Record<string, number | boolean | null> = {}) => traceSearch(`ui:${event}`, { scope: traceScope, generation: generation.current, ...data });
    function cancel(reset = true, reason = "replace") {
        trace(`cancel:${reason}`, { pending: controller.current !== null, reset });
        generation.current++; clearTimeout(debounce.current); controller.current?.abort(); controller.current = null;
        activeMode.current = null;
        if (reset) resetAppleSearch();
    }
    useEffect(() => {
        alive.current = true;
        trace("mount", { available });
        const subscription = AppState.addEventListener("change", state => {
            trace("app-state", { active: state === "active" });
            if (state !== "active") { cancel(true, "inactive"); setQuery(""); setSuggestions([]); setCandidates([]); setRequestMode(null); }
        });
        const show = searchDiagnosticsEnabled && Keyboard.addListener?.("keyboardDidShow", () => trace("keyboard-show"));
        const hide = searchDiagnosticsEnabled && Keyboard.addListener?.("keyboardDidHide", () => trace("keyboard-hide"));
        return () => { trace("unmount"); alive.current = false; subscription.remove(); if (show) show.remove(); if (hide) hide.remove(); cancel(true, "unmount"); };
        // Diagnostic scope belongs to this mounted search instance.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (disabled) { cancel(true, "disabled"); setSuggestions([]); setCandidates([]); setRequestMode(null); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disabled]);
    useEffect(() => {
        if (!connectedAutocomplete || !dismissSuggestionsRef) return;
        const dismiss = () => { setSuggestionsOpen(false); Keyboard.dismiss(); };
        dismissSuggestionsRef.current = dismiss;
        return () => { if (dismissSuggestionsRef.current === dismiss) dismissSuggestionsRef.current = null; };
    }, [connectedAutocomplete, dismissSuggestionsRef]);
    useEffect(() => {
        trace("state", { busy, suggestions: suggestions.length, candidates: candidates.length, error: error !== "", disabled });
        // Diagnostic observation only; no state or request changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [busy, suggestions.length, candidates.length, error, disabled]);
    async function search(mode: SearchRequestMode, text: string) {
        trace(`request:${mode}`, { alive: alive.current, disabled: locked.current, active: AppState.currentState === "active" });
        if (!alive.current || locked.current || AppState.currentState !== "active") { trace("blocked:lifecycle"); return; }
        // Explicit Search replaces autocomplete, but duplicate button/keyboard
        // submissions must not cancel a lookup that is already in progress.
        if (mode === "search" && activeMode.current !== null && activeMode.current !== "complete") { trace("blocked:duplicate"); return; }
        if (mode !== "complete") setSuggestionsOpen(false);
        // Resolution must retain native cached suggestion handles.
        cancel(mode !== "resolve"); const epoch = generation.current, request = new AbortController(); controller.current = request;
        activeMode.current = mode; setRequestMode(mode); setError(""); setSuggestions([]); setCandidates([]);
        trace(`start:${mode}`);
        try {
            const result = mode === "complete" ? await completeAppleSearch(text, "business", request.signal)
                : mode === "resolve" ? await resolveAppleSuggestion(text, request.signal) : await searchApplePlaces(text, "business", request.signal);
            trace(`complete:${mode}`, { epoch, count: result.length });
            if (!alive.current || locked.current || epoch !== generation.current || request.signal.aborted) {
                trace("discard:result", { epoch, alive: alive.current, disabled: locked.current, aborted: request.signal.aborted }); return;
            }
            trace(`accept:${mode}`, { count: result.length });
            if (mode === "complete") setSuggestions(result as AppleSearchSuggestion[]);
            else setCandidates(result as AppleSearchLocation[]);
            if (!result.length) setError("No restaurants found. Try a name and city, or enter a restaurant manually.");
        } catch (error) {
            trace("error", { epoch, current: epoch === generation.current, aborted: request.signal.aborted });
            if (alive.current && !locked.current && epoch === generation.current && !request.signal.aborted) setError(appleSearchErrorMessage(error));
        } finally {
            if (alive.current && epoch === generation.current) { controller.current = null; activeMode.current = null; setRequestMode(null); }
        }
    }
    useEffect(() => {
        if (!available || disabled || query.trim().length < 3) return;
        trace("debounce-scheduled");
        const timer = setTimeout(() => { trace("debounce-fired"); void search("complete", query); }, 400);
        debounce.current = timer;
        return () => clearTimeout(timer);
        // Query edits alone schedule autocomplete; resolution and explicit search do not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, available, disabled]);
    return <View onTouchStart={connectedAutocomplete ? event => event.stopPropagation() : undefined}
        onLayout={searchDiagnosticsEnabled ? event => trace("layout", { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }) : undefined}>
        <Text style={styles.label}>Find a restaurant</Text>
        {!available ? <Text style={styles.message}>{__DEV__
            ? "Apple Maps search needs the local iOS debug development build, with GroupBiteMapKitSearch included. Expo Go cannot run it. Use recent restaurants or manual entry here."
            : "Use a recently saved restaurant or enter one manually."}</Text> : <>
            <View style={connectedAutocomplete ? autocompleteStyles.field : undefined}>
            <View style={connectedAutocomplete ? autocompleteStyles.inputArea : undefined}>
            {connectedAutocomplete && <View pointerEvents="none" style={autocompleteStyles.inputIcon} accessible={false}>
                <Ionicons name="search-outline" size={18} color="#79665E" allowFontScaling={false} accessible={false} importantForAccessibility="no" />
            </View>}
            <TextInput accessibilityLabel="Search restaurants" style={[styles.input, connectedAutocomplete && autocompleteStyles.input]} value={query} editable={!disabled} maxLength={200}
                accessibilityState={connectedAutocomplete ? { expanded: dropdownVisible, busy } : undefined}
                placeholder="Restaurant name and city" autoCorrect={false} returnKeyType="search"
                onFocus={connectedAutocomplete || searchDiagnosticsEnabled ? () => {
                    trace("input-focus");
                    if (connectedAutocomplete) {
                        setSuggestionsOpen(true);
                        if (query.trim().length >= 3 && !suggestions.length && !candidates.length && activeMode.current === null) void search("complete", query);
                    }
                } : undefined}
                onBlur={searchDiagnosticsEnabled ? () => trace("input-blur") : undefined}
                onChangeText={value => {
                    trace("input-change", { changed: value !== query });
                    // iOS can resend the current text when dismissing the keyboard.
                    // Keep the active lookup and displayed results in that case.
                    if (value === query || !alive.current || locked.current) return;
                    if (connectedAutocomplete) setSuggestionsOpen(true);
                    cancel(true, "input-change"); setQuery(value); setSuggestions([]); setCandidates([]); setRequestMode(null); setError("");
                }}
                onSubmitEditing={() => { trace("keyboard-submit"); Keyboard.dismiss(); void search("search", query); }} />
            </View>
            {dropdownVisible && <AutocompleteSuggestions suggestions={suggestions}
                onSelect={id => { if (visibleGeneration === generation.current) void search("resolve", id); }} />}
            </View>
            <Pressable accessibilityRole="button" disabled={disabled || (busy && requestMode !== "complete") || query.trim().length < 3}
                onPressIn={searchDiagnosticsEnabled ? () => trace("button-press-in") : undefined} onPress={() => {
                trace("button-press");
                Keyboard.dismiss(); void search("search", query);
            }} style={primarySearch ? styles.primaryButton : styles.secondaryButton}><Text style={primarySearch ? styles.primaryText : styles.secondaryText}>{searchLabel}</Text></Pressable>
        </>}
        {children}
        {available && <>
            {busy && <Text style={styles.message} accessibilityLiveRegion={connectedAutocomplete ? "polite" : undefined}>Searching Apple Maps...</Text>}
            {!connectedAutocomplete && suggestions.length > 0 && <Text style={styles.label}>Suggestions — tap to see restaurants</Text>}
            {!connectedAutocomplete && suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" disabled={disabled || busy}
                onPress={() => { if (visibleGeneration === generation.current) void search("resolve", item.id); }} style={styles.card}>
                <Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.message}>{item.subtitle}</Text>
            </Pressable>)}
            {candidates.length > 0 && <Text style={styles.label} onLayout={searchDiagnosticsEnabled ? event => trace("results-layout", { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }) : undefined}>Choose a restaurant</Text>}
            {candidates.map(item => <Pressable key={item.id} accessibilityRole="button" disabled={disabled || busy}
                    style={[styles.card, styles.cardBody]} accessibilityHint={selectionHint}
                    accessibilityLabel={`Choose restaurant: ${item.name}, ${item.address}`} onPress={() => {
                        if (!alive.current || locked.current || AppState.currentState !== "active" || visibleGeneration !== generation.current) return;
                        if (Array.from(item.name).length > 100 || Array.from(item.address).length > 300) {
                            setError("This result needs a shorter name or address. Enter the restaurant manually."); return;
                        }
                        Keyboard.dismiss(); choose.current({ name: item.name, address: item.address, cuisine: null, apple_place_id: item.placeId ?? null,
                            mapkit_point: Object.freeze({ name: item.name, address: item.address, latitude: item.latitude, longitude: item.longitude,
                                ...(item.structuredAddress ? { structured_address: item.structuredAddress } : {}) }) });
                    }}><Text style={styles.cardTitle}>{item.name}</Text><Text style={[styles.message, styles.cardMessage]}>{item.address}</Text>
                    <Text style={[styles.secondaryText, styles.cardMessage]}>Use this restaurant</Text></Pressable>)}
        </>}
        {error !== "" && <Text accessibilityRole="alert" style={styles.error} onLayout={searchDiagnosticsEnabled ? event => trace("error-layout", { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height }) : undefined}>{error}</Text>}
    </View>;
}

// Only the Add presentation mounts this list. Leave room for the input/actions
// in the visible viewport; the Add page's keyboard insets keep them scrollable.
function AutocompleteSuggestions({ suggestions, onSelect }: {
    suggestions: AppleSearchSuggestion[]; onSelect: (id: string) => void;
}) {
    const { height, fontScale } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [keyboardTop, setKeyboardTop] = useState<number | null>(() => Keyboard.metrics?.()?.screenY ?? null);
    const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
    useEffect(() => {
        const frame = Keyboard.addListener("keyboardWillChangeFrame", event => setKeyboardTop(event.endCoordinates.screenY));
        const show = Keyboard.addListener("keyboardDidShow", event => setKeyboardTop(event.endCoordinates.screenY));
        const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardTop(null));
        return () => { frame.remove(); show.remove(); hide.remove(); };
    }, []);
    const visibleHeight = Math.min(height, keyboardTop ?? height) - insets.top - insets.bottom;
    // Reserve the input and both action targets; larger text reserves more room.
    let maxHeight = Math.min(280, Math.max(64, visibleHeight - 160 * Math.max(1, fontScale)));
    // Prefer complete rows (including wrapped addresses) over a clipped last row.
    // A row taller than the available space remains fully scrollable.
    if (suggestions.every(item => rowHeights[item.id] > 0)) {
        let fullRowsHeight = 0;
        for (const item of suggestions) {
            if (fullRowsHeight + rowHeights[item.id] > maxHeight - 1) break;
            fullRowsHeight += rowHeights[item.id];
        }
        if (fullRowsHeight > 0) maxHeight = fullRowsHeight + 1;
    }
    return <ScrollView accessibilityLabel="Restaurant suggestions" style={[autocompleteStyles.list, { maxHeight }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="none" nestedScrollEnabled directionalLockEnabled
        bounces={false} overScrollMode="never">
        {suggestions.map((item, index) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ""}`}
            accessibilityHint="Find matching restaurants for this suggestion."
            style={[autocompleteStyles.row, index > 0 && autocompleteStyles.separator]}
            onLayout={event => {
                const measured = event.nativeEvent.layout.height;
                if (measured > 0) setRowHeights(previous => previous[item.id] === measured ? previous : { ...previous, [item.id]: measured });
            }}
            onPress={() => onSelect(item.id)}>
            <View style={autocompleteStyles.words}>
                <Text style={autocompleteStyles.name}>{item.title}</Text>
                {!!item.subtitle && <Text style={autocompleteStyles.description}>{item.subtitle}</Text>}
            </View>
        </Pressable>)}
    </ScrollView>;
}

const autocompleteStyles = StyleSheet.create({
    field: { borderWidth: 1, borderColor: "#BFA99B", borderRadius: 12, backgroundColor: "#FFFFFF", overflow: "hidden", marginBottom: 16 },
    inputArea: { position: "relative" },
    inputIcon: { position: "absolute", left: 16, top: 0, bottom: 0, width: 18, justifyContent: "center", zIndex: 1 },
    input: { borderWidth: 0, borderRadius: 0, marginBottom: 0, paddingLeft: 46 },
    list: { flexGrow: 0, borderTopWidth: 1, borderTopColor: "#E8DACE" },
    row: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center" },
    separator: { borderTopWidth: 1, borderTopColor: "#E8DACE" },
    words: { flex: 1, minWidth: 0, gap: 2 },
    name: { color: "#2D1F1A", fontSize: 16, fontWeight: "500", lineHeight: 22 },
    description: { color: "#79665E", fontSize: 14, lineHeight: 20 },
});
