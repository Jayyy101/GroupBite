import { searchMockAddresses } from "@/lib/mock-address-search";
import { addressSearchErrorMessage, GEOAPIFY_ATTRIBUTION, GEOAPIFY_AUTOCOMPLETE_ENABLED } from "@/lib/address-search";
import type { AddressSearch, AddressSuggestion } from "@/lib/address-search";
import { backendStyles as styles } from "@/styles/backend";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type Props = {
    value: string;
    selection: AddressSuggestion | null;
    onChange: (address: string, selection: AddressSuggestion | null) => void;
    editable: boolean;
    active?: boolean;
    resetKey?: string | number;
    mode?: "mock" | "geoapify";
    // Real mode requires both separate code approval and an authenticated adapter.
    search?: AddressSearch;
};
type Results = { query: string; generation: number; items: readonly AddressSuggestion[] };

export function AddressAutocomplete({ value, selection, onChange, editable, active = true, resetKey,
    mode = "mock", search }: Props) {
    const real = mode === "geoapify";
    const provider = real ? search : search ?? searchMockAddresses;
    const enabled = editable && active && (real ? GEOAPIFY_AUTOCOMPLETE_ENABLED && !!provider : __DEV__);
    // Only an explicit text edit starts a query. Loading/focusing an existing
    // address, or selecting a result, never initiates an automatic lookup.
    const [query, setQuery] = useState<{ text: string } | null>(null);
    const [results, setResults] = useState<Results | null>(null);
    const [status, setStatus] = useState<"idle" | "searching" | "ready" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const generation = useRef(0);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const controller = useRef<AbortController | null>(null);
    const invalidate = useCallback(() => {
        generation.current++;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
        controller.current?.abort();
        controller.current = null;
    }, []);
    const cancel = useCallback(() => {
        invalidate();
        setQuery(null); setResults(null); setStatus("idle"); setErrorMessage("");
    }, [invalidate]);

    useEffect(() => {
        cancel();
        return invalidate;
    }, [active, editable, resetKey, mode, provider, cancel, invalidate]);
    useEffect(() => {
        if (query !== null && query.text !== value) { cancel(); return; }
        if (!enabled || !provider || query === null) return;
        const request = new AbortController();
        controller.current = request;
        const current = ++generation.current;
        const isCurrent = () => current === generation.current && !request.signal.aborted;
        timer.current = setTimeout(() => {
            timer.current = null;
            setStatus("searching");
            Promise.resolve().then(() => {
                if (!isCurrent()) return [];
                return provider(query.text.trim(), request.signal);
            }).then(items => {
                if (!isCurrent()) return;
                setResults({ query: query.text, generation: current, items: items.slice(0, 5) });
                setStatus("ready");
            }).catch(error => {
                if (isCurrent()) { setResults(null); setStatus("error"); setErrorMessage(real ? addressSearchErrorMessage(error) : "Mock suggestions unavailable. Enter an address manually."); }
            });
        }, 400);
        return invalidate;
    }, [query, value, enabled, resetKey, provider, real, invalidate, cancel]);

    function edit(text: string) {
        if (!editable) return;
        cancel();
        // Clear hidden coordinates even when a user retypes the same address.
        onChange(text, null);
        if (enabled && [...text.trim()].length >= 3) setQuery({ text });
    }
    function choose(item: AddressSuggestion, displayed: Results) {
        if (!editable || !active || displayed.generation !== generation.current || displayed.query !== value) return;
        if (item.source === "geoapify" && (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now())) {
            cancel(); setStatus("error"); setErrorMessage("These suggestions expired. Edit the address to search again, or enter it manually."); return;
        }
        cancel();
        onChange(item.address, { ...item });
        Keyboard.dismiss();
    }
    const displayed = enabled && results?.query === value ? results : null;
    return (
        <View>
            <TextInput accessibilityLabel="Restaurant address"
                accessibilityHint={enabled ? `Type at least three characters for ${real ? "address" : "mock"} suggestions, or enter an address manually.` : "Enter the full address, including city."}
                value={value} onChangeText={edit} onBlur={cancel} onSubmitEditing={cancel}
                maxLength={300} editable={editable} autoCorrect={false} autoComplete="off" returnKeyType="done"
                placeholder="Full address, including city" placeholderTextColor="#79665E" style={styles.input} />
            {!real && __DEV__ && editable && <Text style={localStyles.help}>Development only: fictional mock addresses. You can always enter an address manually.</Text>}
            {enabled && selection?.address === value && <Text style={localStyles.help}>{real ? "Address selected." : "Mock address selected."}</Text>}
            {enabled && status === "searching" && <Text accessibilityLiveRegion="polite" style={localStyles.help}>{real ? "Searching addresses..." : "Searching mock addresses..."}</Text>}
            {enabled && status === "error" && <Text accessibilityLiveRegion="polite" style={localStyles.help}>{errorMessage}</Text>}
            {displayed && <View>
                <Text accessibilityLiveRegion="polite" style={localStyles.help}>{displayed.items.length === 0 ? `No ${real ? "address" : "mock"} matches. Enter an address manually.` : `${displayed.items.length} ${real ? "address" : "mock address"} suggestions`}</Text>
                {displayed.items.map(item => <Pressable key={item.id} accessibilityRole="button"
                    accessibilityLabel={`Use ${real ? "address" : "mock address"}: ${item.address}`} accessibilityHint="Fills the address field."
                    onPress={() => choose(item, displayed)} style={localStyles.suggestion}>
                    <Text style={styles.cardTitle}>{item.address}</Text>
                </Pressable>)}
            </View>}
            {real && GEOAPIFY_AUTOCOMPLETE_ENABLED && (status === "ready" || (selection?.source === "geoapify" && selection.address === value)) && <Text style={localStyles.help}>
                <Text accessibilityRole="link" onPress={() => { void Linking.openURL(GEOAPIFY_ATTRIBUTION.geoapifyUrl).catch(() => {}); }}>Powered by Geoapify</Text>
                {" | "}<Text accessibilityRole="link" onPress={() => { void Linking.openURL(GEOAPIFY_ATTRIBUTION.openStreetMapUrl).catch(() => {}); }}>© OpenStreetMap contributors</Text>
            </Text>}
        </View>
    );
}

const localStyles = StyleSheet.create({
    help: { color: "#79665E", fontSize: 14, lineHeight: 20, marginBottom: 12 },
    suggestion: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#BFA99B", borderRadius: 12, minHeight: 48, padding: 12, marginBottom: 8 },
});
