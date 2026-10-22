import PersonalPlaceScreen from "@/app/(app)/(tabs)/(my-places)/personal-place/[id]";
import { Redirect } from "expo-router";
export default function MapPersonalPlace() {
    return __DEV__ ? <PersonalPlaceScreen fromMap /> : <Redirect href="/my-places" />;
}
