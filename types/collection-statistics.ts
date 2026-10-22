export type CollectionMetric = {
    status: "loading" | "ready" | "incomplete" | "error";
    // Only ready has an exact value. knownCount is diagnostic coverage, never
    // an exact total or a promised lower bound for physical venues. Only cities
    // may show it with an explicit identified/coverage qualifier.
    value: number | null;
    knownCount: number | null;
    unresolvedRecords: number | null;
    reason: "identity" | "city" | "limit" | "read" | "access" | "history" | "backend" | null;
};

export type CollectionStatistics = {
    placesSaved: CollectionMetric;
    citiesExplored: CollectionMetric;
    groupsJoined: CollectionMetric;
    yourVisits: CollectionMetric;
};

export type CollectionMembership = { groupId: string; membershipId: string };
export type CollectionStatisticsRead = {
    statistics: CollectionStatistics;
    // Internal authorization proof only; no names, addresses, notes or inventory
    // survive the load. Never reuse proof after a failed access check.
    memberships: CollectionMembership[] | null;
};

export type CollectionPlace = {
    sourceId: string;
    kind: "personal" | "group";
    name: string;
    address: string;
    applePlaceId: string | null;
    verifiedAddress: string | null;
    structured?: import("@/lib/mapkit-address").MapKitAddress | null;
    coordinate?: import("@/types/saved-map").MapSource["coordinate"];
};
