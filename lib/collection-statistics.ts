import { normalizeMapKitAddress } from "@/lib/mapkit-address";
import { validMapCoordinate } from "@/lib/saved-map-model";
import { calculateCollectionLocations, collectionMetric } from "@/lib/collection-identity";
import { readDashboardData, type DashboardReadContext } from "@/lib/home-dashboard";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import type { CollectionMembership, CollectionPlace, CollectionStatistics, CollectionStatisticsRead } from "@/types/collection-statistics";

const PAGE_SIZE = 200;
const MAX_PLACES = 2000;
const MAX_MEMBERSHIPS = 1000;
const MAX_REQUESTS = 80;
type Budget = { requests: number };
type Result<T> = { data: T[] | null; error: unknown; count?: number | null };
class InventoryLimit extends Error {}
const invalid = () => new Error("Collection inventory unavailable.");

export function loadingCollectionStatistics(): CollectionStatistics {
    return { placesSaved: collectionMetric("loading"), citiesExplored: collectionMetric("loading"), groupsJoined: collectionMetric("loading"), yourVisits: collectionMetric("loading") };
}
export function unavailableCollectionStatistics(reason: "read" | "access" = "access"): CollectionStatisticsRead {
    return { memberships: null, statistics: { placesSaved: collectionMetric("error", null, reason),
        citiesExplored: collectionMetric("error", null, reason), groupsJoined: collectionMetric("error", null, reason), yourVisits: collectionMetric("error", null, reason) } };
}

// Exact first-page counts distinguish completion from a short REST-capped page.
// Keyset paging, row budgets and a whole-load deadline bound memory and work.
async function pages<T>(context: DashboardReadContext, budget: Budget, key: keyof T,
    request: (token: string, signal: AbortSignal, after: string | undefined, first: boolean) => PromiseLike<Result<T>>, maximum: number) {
    const values: T[] = [];
    let after: string | undefined, count: number | undefined;
    while (true) {
        if (++budget.requests > MAX_REQUESTS) throw new InventoryLimit();
        const result = await readDashboardData(context, (token, signal) => request(token, signal, after, count === undefined));
        if (count === undefined) {
            if (typeof result.count !== "number" || !Number.isSafeInteger(result.count) || result.count < 0) throw invalid();
            count = result.count;
            if (count > maximum) throw new InventoryLimit();
        }
        if (!Array.isArray(result.data) || result.data.length > PAGE_SIZE) throw invalid();
        for (const value of result.data) {
            const id = value[key];
            if (typeof id !== "string" || !id || (after !== undefined && id <= after)) throw invalid();
            after = id;
            values.push(value);
        }
        if (values.length > count) throw invalid();
        if (values.length === count) return values;
        if (!result.data.length) throw invalid(); // Missing page is not empty success.
    }
}

async function membershipInventory(context: DashboardReadContext, budget: Budget): Promise<CollectionMembership[]> {
    const rows = await pages(context, budget, "group_id", (token, signal, after, first) => {
        const query = supabase.from("group_memberships").select("group_id,membership_id", first ? { count: "exact" } : {})
            .eq("user_id", context.userId).order("group_id").limit(PAGE_SIZE)
            .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
        return after === undefined ? query : query.gt("group_id", after);
    }, MAX_MEMBERSHIPS);
    return rows.map(row => {
        if (typeof row.membership_id !== "string" || !row.membership_id) throw invalid();
        return { groupId: row.group_id, membershipId: row.membership_id };
    });
}
function equalMemberships(expected: CollectionMembership[], current: CollectionMembership[]) {
    if (expected.length !== current.length || expected.some((value, i) => value.groupId !== current[i].groupId
        || value.membershipId !== current[i].membershipId)) throw invalid();
}

// Poll ALL admission IDs, including empty/unshown groups. No restaurant facts,
// histories, addresses or location metadata are fetched by this check.
export async function verifyCollectionMemberships(context: DashboardReadContext, read: CollectionStatisticsRead) {
    if (read.memberships === null) return;
    equalMemberships(read.memberships, await withinDeadline(context, scoped => membershipInventory(scoped, { requests: 0 })));
}

async function personalInventory(context: DashboardReadContext, budget: Budget) {
    return pages(context, budget, "id", (token, signal, after, first) => {
        const query = supabase.from("personal_places").select("id,owner_user_id,name,address,apple_place_id", first ? { count: "exact" } : {})
            .eq("owner_user_id", context.userId).order("id").limit(PAGE_SIZE)
            .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
        return after === undefined ? query : query.gt("id", after);
    }, MAX_PLACES);
}
async function groupInventory(context: DashboardReadContext, budget: Budget) {
    return pages(context, budget, "id", (token, signal, after, first) => {
        const query = supabase.from("group_restaurants").select("id,group_id,restaurant_id,apple_place_id", first ? { count: "exact" } : {})
            .order("id").limit(PAGE_SIZE).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
        return after === undefined ? query : query.gt("id", after);
    }, MAX_PLACES);
}
function fulfilled<T>(result: PromiseSettledResult<T>): T {
    if (result.status === "rejected") throw result.reason;
    return result.value;
}
function required<T>(value: T | undefined): T { if (value === undefined) throw invalid(); return value; }

async function inventory(context: DashboardReadContext, budget: Budget, memberships: CollectionMembership[]): Promise<CollectionPlace[]> {
    const [personalResult, groupResult] = await Promise.allSettled([
        personalInventory(context, budget), memberships.length ? groupInventory(context, budget) : Promise.resolve([]),
    ]);
    const personal = fulfilled(personalResult), groups = fulfilled(groupResult);
    if (personal.length + groups.length > MAX_PLACES) throw new InventoryLimit();
    const admitted = new Set(memberships.map(value => value.groupId));
    if (personal.some(row => row.owner_user_id !== context.userId) || groups.some(row => !admitted.has(row.group_id))) throw invalid();
    const restaurants = new Map<string, { id: string; name: string; address: string }>();
    const restaurantIds = [...new Set(groups.map(row => row.restaurant_id))];
    for (let i = 0; i < restaurantIds.length; i += PAGE_SIZE) {
        const ids = restaurantIds.slice(i, i + PAGE_SIZE);
        const batch = await pages(context, budget, "id", (token, signal, after, first) => {
            const query = supabase.from("restaurants").select("id,name,address", first ? { count: "exact" } : {})
                .in("id", ids).order("id").limit(PAGE_SIZE).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
            return after === undefined ? query : query.gt("id", after);
        }, ids.length);
        if (batch.length !== ids.length) throw invalid();
        batch.forEach(row => restaurants.set(row.id, row));
    }
    const personalLocations = new Map<string, { address_snapshot: string; resolution_status: string; resolution_accuracy: string | null; latitude: number | null; longitude: number | null; standardized_address: string | null }>();
    const groupLocations = new Map<string, { address_snapshot: string; resolution_status: string; resolution_accuracy: string | null; latitude: number | null; longitude: number | null; standardized_address: string | null }>();
    // Optional metadata is still fully paged: missing rows mean unknown, but a
    // failed/truncated metadata read must never masquerade as successful absence.
    for (let i = 0; i < personal.length; i += PAGE_SIZE) {
        const ids = personal.slice(i, i + PAGE_SIZE).map(row => row.id);
        const batch = await pages(context, budget, "personal_place_id", (token, signal, after, first) => {
            const query = supabase.from("personal_place_locations")
                .select("personal_place_id,address_snapshot,resolution_status,resolution_accuracy,latitude,longitude,standardized_address", first ? { count: "exact" } : {})
                .in("personal_place_id", ids).order("personal_place_id").limit(PAGE_SIZE)
                .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
            return after === undefined ? query : query.gt("personal_place_id", after);
        }, ids.length);
        batch.forEach(row => personalLocations.set(row.personal_place_id, row));
    }
    for (let i = 0; i < groups.length; i += PAGE_SIZE) {
        const ids = groups.slice(i, i + PAGE_SIZE).map(row => row.id);
        const batch = await pages(context, budget, "group_restaurant_id", (token, signal, after, first) => {
            const query = supabase.from("group_restaurant_locations")
                .select("group_restaurant_id,address_snapshot,resolution_status,resolution_accuracy,latitude,longitude,standardized_address", first ? { count: "exact" } : {})
                .in("group_restaurant_id", ids).order("group_restaurant_id").limit(PAGE_SIZE)
                .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
            return after === undefined ? query : query.gt("group_restaurant_id", after);
        }, ids.length);
        batch.forEach(row => groupLocations.set(row.group_restaurant_id, row));
    }
    const native = new Map<string, { structured: CollectionPlace["structured"]; coordinate: CollectionPlace["coordinate"] }>();
    for (const kind of ["personal", "group"] as const) {
        const rows = kind === "personal" ? personal : groups;
        for (let i = 0; i < rows.length; i += PAGE_SIZE) {
            const ids = rows.slice(i, i + PAGE_SIZE).map(row => row.id);
            if (kind === "personal") {
                const batch = await pages(context, budget, "personal_place_id", (token, signal, after, first) => {
                    const query = supabase.from("personal_mapkit_locations").select("personal_place_id,address_snapshot,latitude,longitude,structured_address", first ? { count: "exact" } : {})
                        .in("personal_place_id", ids).order("personal_place_id").limit(PAGE_SIZE).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
                    return after === undefined ? query : query.gt("personal_place_id", after);
                }, ids.length);
                for (const row of batch) if (personal.find(p => p.id === row.personal_place_id)?.address === row.address_snapshot) {
                    native.set(`personal:${row.personal_place_id}`, { structured: normalizeMapKitAddress(row.structured_address) ?? null,
                        coordinate: validMapCoordinate(row) ? { latitude: row.latitude, longitude: row.longitude, quality: "apple" } : null });
                }
            } else {
                const batch = await pages(context, budget, "group_restaurant_id", (token, signal, after, first) => {
                    const query = supabase.from("group_mapkit_locations").select("group_restaurant_id,address_snapshot,latitude,longitude,structured_address", first ? { count: "exact" } : {})
                        .in("group_restaurant_id", ids).order("group_restaurant_id").limit(PAGE_SIZE).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
                    return after === undefined ? query : query.gt("group_restaurant_id", after);
                }, ids.length);
                for (const row of batch) {
                    const entry = groups.find(p => p.id === row.group_restaurant_id);
                    if (entry && restaurants.get(entry.restaurant_id)?.address === row.address_snapshot) {
                        native.set(`group:${row.group_restaurant_id}`, { structured: normalizeMapKitAddress(row.structured_address) ?? null,
                            coordinate: validMapCoordinate(row) ? { latitude: row.latitude, longitude: row.longitude, quality: "apple" } : null });
                    }
                }
            }
        }
    }
    const geoPoint = (location: ReturnType<typeof personalLocations.get>, address: string): CollectionPlace["coordinate"] =>
        location?.resolution_status === "resolved" && location.address_snapshot === address && ["address", "building"].includes(location.resolution_accuracy ?? "")
            && validMapCoordinate({ latitude: location.latitude!, longitude: location.longitude! })
            ? { latitude: location.latitude!, longitude: location.longitude!, quality: "verified" } : null;
    const verified = (location: ReturnType<typeof personalLocations.get>, address: string) =>
        location?.resolution_status === "resolved" && location.address_snapshot === address ? location.standardized_address : null;
    return [
        ...personal.map(row => ({ kind: "personal" as const, sourceId: row.id, name: row.name, address: row.address,
            applePlaceId: row.apple_place_id ?? null, ...native.get(`personal:${row.id}`), coordinate: geoPoint(personalLocations.get(row.id), row.address) ?? native.get(`personal:${row.id}`)?.coordinate ?? null, verifiedAddress: verified(personalLocations.get(row.id), row.address) })),
        ...groups.map(row => {
            const restaurant = required(restaurants.get(row.restaurant_id));
            return { kind: "group" as const, sourceId: row.id, name: restaurant.name, address: restaurant.address,
                applePlaceId: row.apple_place_id ?? null, ...native.get(`group:${row.id}`), coordinate: geoPoint(groupLocations.get(row.id), restaurant.address) ?? native.get(`group:${row.id}`)?.coordinate ?? null, verifiedAddress: verified(groupLocations.get(row.id), restaurant.address) };
        }),
    ];
}

async function withinDeadline<T>(context: DashboardReadContext, load: (scoped: DashboardReadContext) => Promise<T>) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener("abort", abort);
    if (context.signal.aborted) abort();
    try {
        return await withRequestDeadline(async deadline => {
            deadline.addEventListener("abort", abort);
            try { return await load({ userId: context.userId, signal: controller.signal }); }
            finally { deadline.removeEventListener("abort", abort); }
        });
    } finally { context.signal.removeEventListener("abort", abort); }
}

async function visitSummary(context: DashboardReadContext) {
    try {
        const result = await readDashboardData(context, async (token, signal) => {
            const result = await supabase.rpc("get_my_visit_event_summary")
                .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
            if (result.error?.code === "PGRST202") throw Object.assign(new Error("Summary backend unavailable."), { code: "PGRST202" });
            return result;
        });
        const row = result.data?.[0];
        if (!row || result.data?.length !== 1 || ![row.linked_events, row.linked_records, row.unlinked_records].every(n => Number.isSafeInteger(n) && n >= 0)
            || row.linked_events > row.linked_records || (row.linked_events === 0) !== (row.linked_records === 0)) throw invalid();
        return row.unlinked_records ? collectionMetric("incomplete", null, "history", row.linked_events, row.unlinked_records)
            : collectionMetric("ready", row.linked_events);
    } catch (error) {
        const missing = typeof error === "object" && error !== null && "code" in error && error.code === "PGRST202";
        return collectionMetric(missing ? "incomplete" : "error", null, missing ? "backend" : "read");
    }
}

export async function readCollectionStatistics(context: DashboardReadContext): Promise<CollectionStatisticsRead> {
    try {
        return await withinDeadline(context, async scoped => {
            const budget = { requests: 0 };
            const memberships = await membershipInventory(scoped, budget);
            let locations: Pick<CollectionStatistics, "placesSaved" | "citiesExplored">;
            try { locations = calculateCollectionLocations(await inventory(scoped, budget, memberships)); }
            catch (error) {
                const metric = collectionMetric(error instanceof InventoryLimit ? "incomplete" : "error", null, error instanceof InventoryLimit ? "limit" : "read");
                locations = { placesSaved: metric, citiesExplored: metric };
            }
            const yourVisits = await visitSummary(scoped);
            // Full-set comparison detects leaving, removal, rejoining and
            // newly joined groups even if they have no recent/preview rows.
            equalMemberships(memberships, await membershipInventory(scoped, budget));
            if (scoped.signal.aborted) throw invalid();
            return { memberships, statistics: { ...locations, yourVisits, groupsJoined: collectionMetric("ready", memberships.length) } };
        });
    } catch (error) {
        if (context.signal.aborted) throw invalid();
        if (error instanceof InventoryLimit) {
            const metric = collectionMetric("incomplete", null, "limit");
            return { memberships: null, statistics: { placesSaved: metric, citiesExplored: metric, groupsJoined: metric, yourVisits: metric } };
        }
        return unavailableCollectionStatistics("read");
    }
}
