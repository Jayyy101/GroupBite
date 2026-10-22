import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import type { MapKitAddress } from "@/lib/mapkit-address";

export type AppleSearchMode = "business" | "address";
export type AppleSearchSuggestion = { id: string; title: string; subtitle: string };
export type AppleSearchLocation = {
    id: string; placeId?: string; name: string; address: string; latitude: number; longitude: number;
    source: "apple-maps-preview"; kind: AppleSearchMode;
    structuredAddress?: MapKitAddress;
};
export type MapKitSearchModule = {
    isAvailable(): boolean;
    complete(query: string, mode: AppleSearchMode, requestId: string): Promise<unknown>;
    search(query: string, mode: AppleSearchMode, requestId: string): Promise<unknown>;
    resolve(suggestionId: string, requestId: string): Promise<unknown>;
    // Optional so an existing debug binary can still complete/search/resolve.
    supportsPlaceIdLookup?(): boolean;
    lookupPlace?(placeId: string, mode: AppleSearchMode, requestId: string): Promise<unknown>;
    cancel(requestId: string): Promise<void>;
    reset(): Promise<void>;
};

export function getMapKitSearchModule(): MapKitSearchModule | null {
    if (!__DEV__ || Platform.OS !== "ios") return null;
    try {
        const module = requireOptionalNativeModule<MapKitSearchModule>("GroupBiteMapKitSearch");
        // An older debug binary may have the module but lack explicit text search.
        return module?.isAvailable() && typeof module.search === "function" ? module : null;
    } catch { return null; }
}
