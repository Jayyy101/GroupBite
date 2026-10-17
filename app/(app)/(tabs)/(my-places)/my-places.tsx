import Ionicons from "@expo/vector-icons/Ionicons";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { PersonalAccess } from "@/components/personal-access";
import { listPersonalPlaces, personalPlaceErrorMessage } from "@/lib/personal-places";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalPlace } from "@/types/database";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

export default function MyPlacesScreen() {
    return <PersonalAccess title="My Places">{userId => <MyPlaces key={userId} userId={userId} />}</PersonalAccess>;
}

function MyPlaces({ userId }: { userId: string }) {
    const router = useRouter();
    const [places, setPlaces] = useState<PersonalPlace[]>([]);
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
        <ScreenScaffold>
            <Text style={styles.title}>My Places</Text>
            <Text style={styles.message}>Only you can see these saved Places. They belong to your account.</Text>
            {__DEV__ && Platform.OS === "ios" && <Pressable accessibilityRole="button" onPress={() => router.push("/dev-map")} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>View My Places on Map</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" onPress={() => router.push("/personal-place-form")} style={styles.primaryButton}>
                <Text style={styles.primaryText}>Add Personal Place</Text>
            </Pressable>
            {loading ? <Text style={styles.message}>Loading My Places...</Text> : error !== "" ? <Text style={styles.error}>{error}</Text> : places.length === 0 ? <Text style={styles.message}>No personal Places yet. Save a place without joining a group.</Text> : places.map(place => (
                <Pressable key={place.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/personal-place/[id]", params: { id: place.id } }, { withAnchor: true })} style={styles.card}>
                    <View style={styles.cardBody}>
                        <View style={styles.cardHeading}>
                            <Text style={[styles.cardTitle, styles.cardHeadingText]}>{place.name}</Text>
                            <Ionicons name="chevron-forward" size={18} color="#79665E" accessible={false} importantForAccessibility="no" />
                        </View>
                        <Text style={[styles.message, styles.cardMessage]}>{place.address}</Text>
                        {place.rating !== null && <Text style={[styles.message, styles.cardMessage]}>Rating: {place.rating}/5</Text>}
                    </View>
                </Pressable>
            ))}
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => setRefresh(value => value + 1)} style={[styles.secondaryButton, loading && styles.disabled]}>
                <Text style={styles.secondaryText}>Refresh My Places</Text>
            </Pressable>
        </ScreenScaffold>
    );
}
