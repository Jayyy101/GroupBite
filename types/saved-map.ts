import type { MapKitAddress } from "@/lib/mapkit-address";

export type MapCoordinate = { latitude: number; longitude: number };
export type MapRegion = MapCoordinate & { latitudeDelta: number; longitudeDelta: number };
export type MapCollection = { id: string; name: string; membershipId: string };
export type MapSource = {
    key: string; kind: "personal" | "group"; entryId: string; groupId: string | null;
    label: string; name: string; address: string; cuisine: string | null; appleId: string | null;
    structured: MapKitAddress | null; standardizedAddress: string | null;
    coordinate: (MapCoordinate & { quality: "verified" | "apple" }) | null;
    stats?: { visitCount: number | null; rating: number | null; ratingKind: "average" | "latest" };
};
export type MapRestaurant = {
    key: string; name: string; address: string; cuisine: string | null;
    sources: MapSource[]; coordinate: MapCoordinate | null; ambiguous: boolean;
};
export type SavedMapData = { sources: MapSource[]; collections: MapCollection[] };
export type MapCanvasHandle = {
    fit: () => void; focus: (point: MapCoordinate) => void; zoom: (direction: 1 | -1) => void;
};
export type MapCanvasProps = {
    restaurants: MapRestaurant[]; selected: string | null; initialRegion: MapRegion | null;
    padding: { top: number; bottom: number; left: number; right: number }; showUser: boolean;
    onSelect: (key: string) => void; onDismiss: () => void; onRegion: (region: MapRegion) => void;
};
