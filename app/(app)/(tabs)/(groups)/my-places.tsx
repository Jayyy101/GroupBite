import Ionicons from "@expo/vector-icons/Ionicons";
import { CollectionStats, RestaurantRow } from "@/components/collection-browse";
import { backToContext, personalPlaceHref, type DetailOrigin } from "@/lib/restaurant-navigation";
import { collectionStyles as s } from "@/styles/collections";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { PersonalAccess } from "@/components/personal-access";
import { listPersonalPlaces, personalPlaceErrorMessage } from "@/lib/personal-places";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlaceSummary } from "@/types/database";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";

export default function MyPlacesScreen({ origin = "collection" }: { origin?: DetailOrigin }) {
    return <PersonalAccess title="My Places">{userId => <MyPlaces key={userId} userId={userId} origin={origin} />}</PersonalAccess>;
}

function MyPlaces({ userId, origin }: { userId: string; origin: DetailOrigin }) {
    const { fontScale } = useWindowDimensions();
    const router = useRouter();
    const [places, setPlaces] = useState<PersonalPlaceSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        let active = true;
        setPlaces([]); setLoading(true); setError("");
        listPersonalPlaces(userId).then(data => { if (active) setPlaces(data); })
            .catch(error => { if (active) setError(personalPlaceErrorMessage(error)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [userId, refresh]);
    return (
        <ScreenScaffold key={fontScale} edgeToEdge onBack={() => backToContext(router, origin === "home" ? "/" : "/groups")}>
            <Text style={s.eyebrow}>YOUR PRIVATE COLLECTION</Text>
            <Text accessibilityRole="header" style={[s.title, fontScale > 1.5 && s.largeTitle]}>My Places</Text>
            <Text style={s.description}>A little record of everywhere you’ve eaten. Saved for you, seen only by you.</Text>
            {!loading && !error && <CollectionStats restaurants={places.length} visits={places.reduce((sum, place) => sum + place.total_visit_count, 0)} />}
            <View style={s.section}>
                <Text accessibilityRole="header" style={s.sectionTitle}>Your restaurants</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Refresh My Places" disabled={loading}
                    onPress={() => setRefresh(value => value + 1)} style={[s.refresh, loading && styles.disabled]}>
                    <Ionicons name="refresh-outline" size={20} color="#C9472C" accessible={false} />
                </Pressable>
            </View>
            {loading ? <Text style={s.empty}>Loading My Places...</Text> : error !== "" ? <Text style={styles.error}>{error}</Text> : places.length === 0 ?
                <Text style={s.empty}>Your collection starts with a visit. Use Add to save your first restaurant to My Places.</Text> :
                <View style={s.surface}>{places.map((place, index) => <RestaurantRow key={place.id} first={index === 0} restaurant={place}
                    onPress={() => router.push(personalPlaceHref(place.id, origin), { withAnchor: true })} />)}</View>}
            {__DEV__ && Platform.OS === "ios" && <Pressable accessibilityRole="button" onPress={() => router.navigate("/saved-map")} style={[styles.secondaryButton, { marginTop: 22 }]}>
                <Text style={styles.secondaryText}>Explore on Map</Text>
            </Pressable>}
        </ScreenScaffold>
    );
}
