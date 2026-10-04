import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Place } from "../types/place";

const PLACES_KEY = "savedPlaces";

export async function getSavedPlaces(): Promise<Place[]> {
    const storedPlaces = await AsyncStorage.getItem(PLACES_KEY);
    if (storedPlaces === null) {
        return [];
    }

    return JSON.parse(storedPlaces) as Place[];
}

export async function savePlace(place: Place) {
    const currentPlaces = await getSavedPlaces();
    const updatedPlaces = [...currentPlaces, place];

    await AsyncStorage.setItem(
        PLACES_KEY,
        JSON.stringify(updatedPlaces)
    );
}
