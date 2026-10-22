import GroupRestaurantScreen from "@/app/(app)/(tabs)/(groups)/group/[id]/restaurant/[entryId]";
import { Redirect } from "expo-router";
export default function MapGroupRestaurant() {
    return __DEV__ ? <GroupRestaurantScreen origin="map" /> : <Redirect href="/my-places" />;
}
