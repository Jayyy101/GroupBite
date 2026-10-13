import DevMapKitPreview from "@/components/dev-mapkit-preview";
import { appleSearchAvailable, appleSearchErrorMessage, completeAppleSearch, resetAppleSearch,
    resolveAppleSuggestion, searchApplePlaces, type AppleSearchLocation, type AppleSearchMode,
    type AppleSearchSuggestion } from "@/lib/apple-map-search";
import { backendStyles as styles } from "@/styles/backend";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Keyboard, Pressable, Text, TextInput, View } from "react-native";

// Results and coordinates live only in this disposable, development-only UI.
// The callback receives only an optional ID already validated by the adapter.
export default function PersonalApplePlacePicker({ disabled, onSelect }: { disabled: boolean; onSelect: (id: string | null) => void }) {
    const [open, setOpen] = useState(false);
    const [available] = useState(appleSearchAvailable);
    return <View>
        <Pressable accessibilityRole="button" disabled={disabled} style={styles.secondaryButton}
            onPress={() => { if (disabled) return; onSelect(null); setOpen(value => !value); }}>
            <Text style={styles.secondaryText}>{open ? "Close Apple Maps picker" : "Choose Apple Maps place (optional)"}</Text>
        </Pressable>
        {open && <>
            <Text style={styles.message}>Enter your own restaurant name and address above. In development, explicitly selecting a place with an Apple Place ID includes only that ID when you save. Apple map names, addresses and coordinates are not copied or saved.</Text>
            {!available ? <Text style={styles.message}>Apple search requires a compatible local iOS debug build. You can save normally without an Apple ID.</Text>
                : <PickerSearch disabled={disabled} onSelect={onSelect} />}
        </>}
    </View>;
}

function PickerSearch({ disabled, onSelect }: { disabled: boolean; onSelect: (id: string | null) => void }) {
    const [query, setQuery] = useState(""), [mode, setMode] = useState<AppleSearchMode>("business");
    const [action, setAction] = useState<"complete" | "search">("complete"), [edits, setEdits] = useState(0);
    const [suggestions, setSuggestions] = useState<AppleSearchSuggestion[]>([]), [candidates, setCandidates] = useState<AppleSearchLocation[]>([]);
    const [selected, setSelected] = useState<AppleSearchLocation | null>(null);
    const [busy, setBusy] = useState(false), [finished, setFinished] = useState(false), [error, setError] = useState("");
    const active = useRef(false), generation = useRef(0), pending = useRef<AbortController | null>(null);
    const locked = useRef(disabled); locked.current = disabled;
    const selectionCallback = useRef(onSelect); selectionCallback.current = onSelect;
    const visibleGeneration = generation.current;
    const clearSearch = useCallback(() => {
        generation.current++; pending.current?.abort(); pending.current = null; resetAppleSearch();
        setQuery(""); setEdits(0); setSuggestions([]); setCandidates([]); setSelected(null); setBusy(false); setFinished(false); setError("");
        selectionCallback.current(null);
    }, []);
    useEffect(() => {
        active.current = true;
        // Invalidate even when React batches an inactive -> active transition
        // and the access gate never visibly unmounts the picker.
        const subscription = AppState.addEventListener("change", state => { if (state !== "active") clearSearch(); });
        return () => { active.current = false; subscription.remove(); pending.current?.abort(); resetAppleSearch(); };
    }, [clearSearch]);
    useEffect(() => { if (disabled) clearSearch(); }, [disabled, clearSearch]);
    useEffect(() => {
        if (disabled || edits === 0 || query.trim().length < 3) return;
        const current = generation.current, controller = new AbortController();
        pending.current = controller;
        const timer = setTimeout(() => {
            const request = action === "search" ? searchApplePlaces(query, mode, controller.signal) : completeAppleSearch(query, mode, controller.signal);
            request.then(items => {
                if (!active.current || locked.current || controller.signal.aborted || current !== generation.current) return;
                if (action === "search") setCandidates(items as AppleSearchLocation[]);
                else setSuggestions(items as AppleSearchSuggestion[]);
                setFinished(true);
            }).catch(error => {
                if (active.current && !locked.current && !controller.signal.aborted && current === generation.current) setError(appleSearchErrorMessage(error));
            }).finally(() => {
                if (active.current && !locked.current && !controller.signal.aborted && current === generation.current) setBusy(false);
                if (pending.current === controller) pending.current = null;
            });
        }, 400);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [disabled, edits, query, mode, action]);

    function edit(value: string, nextMode = mode, nextAction: "complete" | "search" = "complete") {
        if (!active.current || locked.current) return;
        generation.current++; pending.current?.abort(); pending.current = null; resetAppleSearch(); onSelect(null);
        setQuery(value); setMode(nextMode); setAction(nextAction); setEdits(value => value + 1);
        setSuggestions([]); setCandidates([]); setSelected(null); setFinished(false); setError("");
        setBusy(value.trim().length >= 3);
    }
    async function resolve(item: AppleSearchSuggestion) {
        if (!active.current || locked.current || visibleGeneration !== generation.current || pending.current || !suggestions.some(value => value.id === item.id)) return;
        const controller = new AbortController(); pending.current = controller;
        setBusy(true); setError(""); setFinished(false); onSelect(null);
        try {
            const items = await resolveAppleSuggestion(item.id, controller.signal);
            if (!active.current || locked.current || controller.signal.aborted || visibleGeneration !== generation.current) return;
            setCandidates(items); setSuggestions([]); setFinished(true);
        } catch (error) {
            if (active.current && !locked.current && !controller.signal.aborted && visibleGeneration === generation.current) setError(appleSearchErrorMessage(error));
        } finally {
            if (pending.current === controller) {
                pending.current = null;
                if (active.current && !locked.current) setBusy(false);
            }
        }
    }
    return <View>
        {(["business", "address"] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: mode === value }}
            disabled={disabled} style={styles.secondaryButton} onPress={() => edit(query, value)}>
            <Text style={styles.secondaryText}>{value === "business" ? "Businesses" : "Addresses"}</Text></Pressable>)}
        <TextInput accessibilityLabel="Apple Maps search" style={styles.input} value={query} editable={!disabled} maxLength={200}
            placeholder="Search Apple Maps with a name or address and city" autoCorrect={false} returnKeyType="search"
            onChangeText={value => { if (value !== query) edit(value); }}
            onSubmitEditing={() => { Keyboard.dismiss(); if (query.trim().length >= 3 && !busy) edit(query, mode, "search"); }} />
        <Pressable accessibilityRole="button" disabled={disabled || query.trim().length < 3 || busy} style={styles.secondaryButton}
            onPress={() => { Keyboard.dismiss(); if (!busy && query.trim().length >= 3) edit(query, mode, "search"); }}>
            <Text style={styles.secondaryText}>Search Apple places</Text></Pressable>
        {busy && <Text accessibilityLiveRegion="polite" style={styles.message}>Searching Apple Maps...</Text>}
        {error !== "" && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Select Apple suggestion: ${item.title}`}
            disabled={disabled || busy} style={styles.card} onPress={() => resolve(item)}>
            <Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.message}>{item.subtitle}</Text></Pressable>)}
        {candidates.map(item => <View key={item.id}>
            <DevMapKitPreview selection={item} saved={null} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Preview Apple location: ${item.name}`}
            disabled={disabled || busy} style={styles.card} onPress={() => {
                if (!active.current || locked.current || visibleGeneration !== generation.current || !candidates.some(value => value.id === item.id)) return;
                setSelected(item); onSelect(item.placeId ?? null); Keyboard.dismiss();
            }}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.message}>{item.address}</Text></Pressable>
        </View>)}
        {!busy && finished && suggestions.length === 0 && candidates.length === 0 && !error &&
            <Text style={styles.message}>No matching Apple results. Try Search Apple places or a more specific address and city. You can still save normally.</Text>}
        {selected && <>
            <Text style={styles.message}>Apple preview: {selected.name}{"\n"}{selected.address}</Text>
            <Text style={styles.message}>{selected.placeId ? "Apple Place ID selected. It will be included when you save this personal place in development." : "No Apple Place ID for this result. You can still save normally."}</Text>
        </>}
    </View>;
}
