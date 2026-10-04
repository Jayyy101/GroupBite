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

export async function updatePlace(place: Place) {
    const currentPlaces = await getSavedPlaces();
    if (!currentPlaces.some((item) => item.id === place.id)) {
        throw new Error("This place could not be found.");
    }

    const updatedPlaces = currentPlaces.map((item) =>
        item.id === place.id ? place : item
    );
    await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(updatedPlaces));
}

export async function deletePlace(id: string) {
    const currentPlaces = await getSavedPlaces();
    const remainingPlaces = currentPlaces.filter((place) => place.id !== id);
    await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(remainingPlaces));
}
