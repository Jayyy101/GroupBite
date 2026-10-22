import type { Router } from "expo-router";
import type { AddDestinationResult, AddRestaurant } from "@/types/database";

// Browsing origin chooses a stack, never grants access to its records. Home,
// Add results and Saved Map reuse the same permission-checked detail screens.
export type DetailOrigin = "collection" | "home" | "add" | "map";
export function detailOrigin(params: { fromAdd?: unknown; fromMap?: unknown; fromHome?: unknown }): DetailOrigin {
    return params.fromHome === "1" ? "home" : params.fromMap === "1" ? "map" : params.fromAdd === "1" ? "add" : "collection";
}
export function detailOriginParams(origin: DetailOrigin) {
    return origin === "home" ? { fromHome: "1" } : origin === "map" ? { fromMap: "1" } : origin === "add" ? { fromAdd: "1" } : {};
}
export function personalPlaceHref(id: string, origin: DetailOrigin = "collection") {
    return { pathname: origin === "home" ? "/home/personal-place/[id]" as const : origin === "add" ? "/add/personal-place/[id]" as const
        : origin === "map" ? "/map/personal-place/[id]" as const : "/personal-place/[id]" as const, params: { id } };
}
export function groupHref(id: string, origin: DetailOrigin = "collection") {
    return { pathname: origin === "home" ? "/home/group/[id]" as const : "/group/[id]" as const, params: { id } };
}
export function destinationHref(result: AddDestinationResult, origin: DetailOrigin = "collection") {
    return result.destination_kind === "personal" ? personalPlaceHref(result.entry_id!, origin)
        : { pathname: origin === "home" ? "/home/group/[id]/restaurant/[entryId]" as const
            : origin === "add" ? "/add/group/[id]/restaurant/[entryId]" as const
            : origin === "map" ? "/map/group/[id]/restaurant/[entryId]" as const : "/group/[id]/restaurant/[entryId]" as const,
            params: { id: result.group_id!, entryId: result.entry_id! } };
}
export function detailFallback(origin: DetailOrigin, groupId?: string) {
    return origin === "home" ? "/" as const : origin === "map" ? "/saved-map" as const : origin === "add" ? "/add" as const
        : groupId ? groupHref(groupId) : "/my-places" as const;
}
// Custom Back follows the same mounted history as native Back/swipe. Only a
// missing history uses the known local fallback; no return URLs or private data.
export function backToContext(router: Router, fallback: Parameters<Router["replace"]>[0]) {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
}

// A single Add Another Visit can return to its existing browsing detail. A
// different destination uses its own collection; multi/partial saves keep Add's
// recovery summary. Never route a finished form back into its old form history.
export function savedDestinationHref(result: AddDestinationResult, source: AddRestaurant, origin: DetailOrigin) {
    const same = result.destination_kind === source.destination_kind && result.entry_id === source.entry_id
        && result.group_id === (source.group_id ?? null);
    return destinationHref(result, same ? origin : "collection");
}
