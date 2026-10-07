import { isUuid, isVisitDate, restaurantErrorMessage } from "@/lib/restaurant-ui";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { isGroupAccessDenied } from "@/lib/group-errors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { Group, SaveVisitArgs } from "@/types/database";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

export default function AddVisitScreen() {
    const router = useRouter();
    const { groupId, restaurantId } = useLocalSearchParams<{ groupId?: string; restaurantId?: string }>();
    const { session, loading } = useAuth();
    if (!loading && session) {
        return <VisitForm key={`${session.user.id}:${groupId}:${restaurantId}`} groupId={groupId} restaurantId={restaurantId} />;
    }
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Pressable accessibilityRole="button" onPress={() => router.dismissTo("/groups")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>Add Restaurant / Visit</Text>
            <Text style={styles.message}>{loading ? "Restoring your session..." : "Sign in from Groups to save a visit."}</Text>
        </ScrollView>
    );
}

function VisitForm({ groupId, restaurantId }: { groupId?: string; restaurantId?: string }) {
    const router = useRouter();
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [cuisine, setCuisine] = useState("");
    const [visitedOn, setVisitedOn] = useState("");
    const [rating, setRating] = useState<number | null>(null);
    const [wouldGoAgain, setWouldGoAgain] = useState<boolean | null>(null);
    const [notes, setNotes] = useState("");
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroups, setSelectedGroups] = useState<string[]>(isUuid(groupId) ? [groupId] : []);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const lastSubmission = useRef<{ payload: string; requestId: string } | null>(null);
    const isFocused = useIsFocused();
    const { version: foregroundVersion, isActive } = useForegroundRefresh();

    useEffect(() => {
        setGroups([]);
        setLoading(true);
        if (!isFocused || !isActive) return;
        let active = true;
        let pending = false;
        let restaurantLoaded = restaurantId === undefined;
        async function loadForm(includeRestaurant = false) {
            if (pending) return;
            pending = true;
            setLoadError("");
            try {
                const result = await supabase.from("groups").select("*").order("name");
                if (result.error) throw result.error;
                if (!active) return;
                setGroups(result.data);
                setSelectedGroups(selected => selected.filter(id => result.data.some(group => group.id === id)));
                if ((includeRestaurant || !restaurantLoaded) && restaurantId !== undefined) {
                    if (!isUuid(restaurantId)) throw new Error("Invalid restaurant");
                    const restaurant = await supabase.from("restaurants").select("*").eq("id", restaurantId).single();
                    if (restaurant.error) throw restaurant.error;
                    if (active) {
                        setName(restaurant.data.name);
                        setAddress(restaurant.data.address);
                        setCuisine(restaurant.data.cuisine ?? "");
                        restaurantLoaded = true;
                    }
                }
            } catch {
                if (active) {
                    setGroups([]);
                    setLoadError("Could not load groups or restaurant details. Check your connection and refresh.");
                }
            } finally {
                pending = false;
                if (active) setLoading(false);
            }
        }
        loadForm(true);
        const timer = setInterval(() => { loadForm(); }, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [restaurantId, refreshVersion, isFocused, isActive, foregroundVersion]);

    async function handleSave() {
        if (saving || loading || loadError !== "") return;
        setError("");
        if (!name.trim() || !address.trim()) {
            setError("Please enter a restaurant name and address.");
            return;
        }
        if (visitedOn.trim() !== "" && !isVisitDate(visitedOn.trim())) {
            setError("Enter a real visit date as YYYY-MM-DD, or leave it blank.");
            return;
        }
        if (selectedGroups.length === 0) {
            setError("Please choose at least one group.");
            return;
        }
        const details: Omit<SaveVisitArgs, "client_request_id"> = {
            target_group_ids: [...selectedGroups].sort(),
            restaurant_name: name.trim(),
            restaurant_address: address.trim(),
            restaurant_cuisine: cuisine.trim() || null,
            visit_date: visitedOn.trim() || null,
            visit_rating: rating,
            visit_would_go_again: wouldGoAgain,
            visit_notes: notes.trim() || null,
        };
        const payload = JSON.stringify(details);
        if (lastSubmission.current?.payload !== payload) {
            // This is a retry identifier, not a secret or an access token.
            lastSubmission.current = { payload, requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
        }
        setSaving(true);
        try {
            const { error } = await supabase.rpc("save_restaurant_visit", {
                ...details, client_request_id: lastSubmission.current.requestId,
            });
            if (error) throw error;
        } catch (error) {
            setError(restaurantErrorMessage(error));
            if (isGroupAccessDenied(error)) {
                setGroups([]);
                setRefreshVersion(value => value + 1);
            }
            return;
        } finally {
            setSaving(false);
        }
        if (selectedGroups.length === 1) {
            router.dismissTo({ pathname: "/group/[id]", params: { id: selectedGroups[0] } });
        } else {
            router.dismissTo("/groups");
        }
    }

    const existingRestaurant = restaurantId !== undefined;
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => router.canGoBack() ? router.back() : router.replace("/groups")} style={[styles.secondaryButton, styles.backButton]}>
                <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Text style={styles.title}>{existingRestaurant ? "Add a Visit" : "Add Restaurant / Visit"}</Text>
            <Text style={styles.message}>Restaurant facts are shared. Your visit is private to each selected group.</Text>
            {loading && <Text style={styles.message}>Loading groups and restaurant...</Text>}
            {loadError !== "" && <Text style={styles.error}>{loadError}</Text>}
            <Text style={styles.label}>Restaurant name</Text>
            <TextInput accessibilityLabel="Restaurant name" value={name} onChangeText={setName} maxLength={100} editable={!saving && !existingRestaurant} placeholder="Restaurant name" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.label}>Address</Text>
            <TextInput accessibilityLabel="Restaurant address" value={address} onChangeText={setAddress} maxLength={300} editable={!saving && !existingRestaurant} placeholder="Full address, including city" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.label}>Cuisine (optional)</Text>
            <TextInput accessibilityLabel="Cuisine" value={cuisine} onChangeText={setCuisine} maxLength={100} editable={!saving && !existingRestaurant} placeholder="Cuisine" placeholderTextColor="#79665E" style={styles.input} />
            <Text style={styles.message}>{existingRestaurant ? "These shared facts stay unchanged when you add a visit." : "An exact name and address match reuses existing facts. Different locations stay separate."}</Text>
            <Text style={styles.label}>Visit date (optional)</Text>
            <TextInput accessibilityLabel="Visit date" value={visitedOn} onChangeText={setVisitedOn} maxLength={10} editable={!saving} placeholder="YYYY-MM-DD" placeholderTextColor="#79665E" autoCorrect={false} style={styles.input} />
            <Text style={styles.label}>Rating (optional, 1–5)</Text>
            <View style={formStyles.row}>
                {[1, 2, 3, 4, 5].map(value => (
                    <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Rating ${value} out of 5`} accessibilityState={{ selected: rating === value }} disabled={saving} onPress={() => setRating(rating === value ? null : value)} style={[formStyles.choice, rating === value && formStyles.selected]}>
                        <Text style={rating === value ? styles.primaryText : styles.secondaryText}>{value}</Text>
                    </Pressable>
                ))}
            </View>
            <Text style={styles.label}>Would you go again? (optional)</Text>
            <View style={formStyles.row}>
                {[true, false].map(value => (
                    <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected: wouldGoAgain === value }} disabled={saving} onPress={() => setWouldGoAgain(wouldGoAgain === value ? null : value)} style={[formStyles.choice, wouldGoAgain === value && formStyles.selected]}>
                        <Text style={wouldGoAgain === value ? styles.primaryText : styles.secondaryText}>{value ? "Yes" : "No"}</Text>
                    </Pressable>
                ))}
            </View>
            <Text style={styles.message}>Tap a selected choice again to leave it unanswered.</Text>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput accessibilityLabel="Visit notes" value={notes} onChangeText={setNotes} maxLength={4000} multiline editable={!saving} placeholder="A memory from this visit" placeholderTextColor="#79665E" style={[styles.input, formStyles.notes]} />
            <Text style={styles.label}>Save to groups</Text>
            {!loading && loadError === "" && groups.length === 0 && <Text style={styles.message}>Create or join a group from Groups before saving a visit.</Text>}
            {groups.map(group => {
                const selected = selectedGroups.includes(group.id);
                return (
                    <Pressable key={group.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} disabled={saving || loading} onPress={() => setSelectedGroups(ids => selected ? ids.filter(id => id !== group.id) : [...ids, group.id])} style={[styles.card, selected && formStyles.selected]}>
                        <Text style={selected ? styles.primaryText : styles.cardTitle}>{selected ? "✓ " : ""}{group.name}</Text>
                    </Pressable>
                );
            })}
            {error !== "" && <Text style={styles.error}>{error}</Text>}
            <Pressable accessibilityRole="button" disabled={saving || loading || loadError !== "" || groups.length === 0} onPress={handleSave} style={[styles.primaryButton, (saving || loading || loadError !== "" || groups.length === 0) && styles.disabled]}>
                <Text style={styles.primaryText}>{saving ? "Saving..." : "Save Visit"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={saving || loading} onPress={() => setRefreshVersion(value => value + 1)} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Refresh Groups</Text>
            </Pressable>
        </ScrollView>
    );
}

const formStyles = StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    choice: { minWidth: 48, minHeight: 48, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E85D3F", borderRadius: 12 },
    selected: { backgroundColor: "#E85D3F", borderColor: "#E85D3F" },
    notes: { minHeight: 112, textAlignVertical: "top" },
});
