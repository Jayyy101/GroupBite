import { accountAccessToken } from "@/lib/account-session";
import { normalizeMapKitAddress } from "@/lib/mapkit-address";
import { withRequestDeadline } from "@/lib/request-deadline";
import { isUuid } from "@/lib/restaurant-ui";
import { validMapCoordinate } from "@/lib/saved-map-model";
import { supabase } from "@/lib/supabase";
import type { Database, SavedLocation } from "@/types/database";
import type { MapCollection, MapSource, SavedMapData } from "@/types/saved-map";

type Context = { userId: string; signal: AbortSignal; budget: { requests: number } };
type Reply<T> = { data: T[] | null; error: unknown; count?: number | null };
type Personal = Pick<Database["public"]["Tables"]["personal_places"]["Row"], "id" | "owner_user_id" | "name" | "address" | "cuisine" | "apple_place_id">;
type Entry = Pick<Database["public"]["Tables"]["group_restaurants"]["Row"], "id" | "group_id" | "restaurant_id" | "apple_place_id">;
type Facts = { id: string; name: string; address: string; cuisine: string | null };
type Point = Database["public"]["Tables"]["group_mapkit_locations"]["Row"];
const PAGE = 200, MAX_ENTRIES = 2000;
const fail = () => new Error("Could not verify your saved restaurants. Refresh to try again.");
function active(context: Context) { if (context.signal.aborted) throw fail(); }

// Includes account preflight in the deadline; late authorization cannot dispatch
// HTTP after cancellation. Every request has an explicitly pinned user JWT.
async function read<T>(context: Context, work: (token: string, signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    active(context);
    if (++context.budget.requests > 80) throw fail();
    return withRequestDeadline(async deadline => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        context.signal.addEventListener("abort", abort, { once: true });
        deadline.addEventListener("abort", abort, { once: true });
        try {
            const token = await accountAccessToken(context.userId);
            active(context);
            if (deadline.aborted) throw fail();
            const result = await work(token, controller.signal);
            active(context);
            if (deadline.aborted) throw fail();
            return result;
        } finally {
            context.signal.removeEventListener("abort", abort);
            deadline.removeEventListener("abort", abort);
        }
    });
}

async function pages<T>(context: Context, key: keyof T,
    query: (token: string, signal: AbortSignal, after: string | undefined, first: boolean) => PromiseLike<Reply<T>>, max = MAX_ENTRIES): Promise<T[]> {
    const rows: T[] = []; let after: string | undefined, count: number | undefined;
    while (true) {
        const reply = await read(context, (token, signal) => query(token, signal, after, count === undefined));
        if (reply.error || !Array.isArray(reply.data)) throw fail();
        if (count === undefined) {
            if (!Number.isSafeInteger(reply.count) || reply.count! < 0 || reply.count! > max) throw fail();
            count = reply.count!;
        }
        if (reply.data.length > PAGE) throw fail();
        for (const row of reply.data) {
            const id = row[key];
            if (typeof id !== "string" || !isUuid(id) || (after !== undefined && id <= after)) throw fail();
            after = id; rows.push(row);
        }
        if (rows.length > count) throw fail();
        if (rows.length === count) return rows;
        if (!reply.data.length) throw fail(); // Missing page never means complete.
    }
}
async function collections(context: Context): Promise<MapCollection[]> {
    const [memberships, groups] = await Promise.all([
        pages(context, "group_id", (token, signal, after, first) => {
            const q = supabase.from("group_memberships").select("group_id,membership_id", first ? { count: "exact" } : {})
                .eq("user_id", context.userId).order("group_id").limit(PAGE);
            return (after ? q.gt("group_id", after) : q).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
        }, 1000),
        pages(context, "id", (token, signal, after, first) => {
            const q = supabase.from("groups").select("id,name", first ? { count: "exact" } : {}).order("id").limit(PAGE);
            return (after ? q.gt("id", after) : q).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
        }, 1000),
    ]);
    if (groups.length !== memberships.length) throw fail();
    return memberships.map(m => {
        const g = groups.find(g => g.id === m.group_id);
        if (!g || !isUuid(m.membership_id) || !g.name?.trim()) throw fail();
        return { id: g.id, name: g.name, membershipId: m.membership_id };
    });
}
async function batchFacts(context: Context, ids: string[]): Promise<Facts[]> {
    const all: Facts[] = [];
    for (let i = 0; i < ids.length; i += PAGE) {
        const batch = ids.slice(i, i + PAGE);
        const rows = await pages(context, "id", (token, signal, after, first) => {
            const q = supabase.from("restaurants").select("id,name,address,cuisine", first ? { count: "exact" } : {})
                .in("id", batch).order("id").limit(PAGE);
            return (after ? q.gt("id", after) : q).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
        }, batch.length);
        if (rows.length !== batch.length || rows.some(r => !batch.includes(r.id))) throw fail();
        all.push(...rows);
    }
    return all;
}

// No histories, notes, mutation calls, provider lookup or persistent cache. RLS
// remains authoritative. A membership/read failure discards the whole snapshot.
export async function readSavedMap(userId: string, signal: AbortSignal): Promise<SavedMapData> {
    return withRequestDeadline(async deadline => {
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true }); deadline.addEventListener("abort", abort, { once: true });
        if (signal.aborted) controller.abort();
        const context = { userId, signal: controller.signal, budget: { requests: 0 } };
        try {
            const before = await collections(context);
            const [personal, entries] = await Promise.all([
                pages<Personal>(context, "id", (token, s, after, first) => {
                    const q = supabase.from("personal_places").select("id,owner_user_id,name,address,cuisine,apple_place_id", first ? { count: "exact" } : {})
                        .eq("owner_user_id", userId).order("id").limit(PAGE);
                    return (after ? q.gt("id", after) : q).setHeader("Authorization", `Bearer ${token}`).abortSignal(s).retry(false);
                }),
                before.length ? pages<Entry>(context, "id", (token, s, after, first) => {
                    const q = supabase.from("group_restaurants").select("id,group_id,restaurant_id,apple_place_id", first ? { count: "exact" } : {}).order("id").limit(PAGE);
                    return (after ? q.gt("id", after) : q).setHeader("Authorization", `Bearer ${token}`).abortSignal(s).retry(false);
                }) : Promise.resolve([] as Entry[]),
            ]);
            if (personal.length + entries.length > MAX_ENTRIES || personal.some(p => p.owner_user_id !== userId)
                || entries.some(e => !before.some(g => g.id === e.group_id) || !isUuid(e.restaurant_id))) throw fail();
            const facts = await batchFacts(context, [...new Set(entries.map(e => e.restaurant_id))]);
            const [personalPoints, groupPoints] = await Promise.all([
                personal.length ? pages(context, "personal_place_id", (token, s, after, first) => {
                    const q = supabase.from("personal_mapkit_locations").select("personal_place_id,owner_user_id,address_snapshot,latitude,longitude,structured_address", first ? { count: "exact" } : {})
                        .eq("owner_user_id", userId).order("personal_place_id").limit(PAGE);
                    return (after ? q.gt("personal_place_id", after) : q).setHeader("Authorization", `Bearer ${token}`).abortSignal(s).retry(false);
                }) : Promise.resolve([]),
                entries.length ? pages(context, "group_restaurant_id", (token, s, after, first) => {
                    const q = supabase.from("group_mapkit_locations").select("group_restaurant_id,address_snapshot,latitude,longitude,structured_address", first ? { count: "exact" } : {})
                        .order("group_restaurant_id").limit(PAGE);
                    return (after ? q.gt("group_restaurant_id", after) : q).setHeader("Authorization", `Bearer ${token}`).abortSignal(s).retry(false);
                }) : Promise.resolve([]),
            ]);
            if (personalPoints.some(p => p.owner_user_id !== userId || !personal.some(e => e.id === p.personal_place_id))
                || groupPoints.some(p => !entries.some(e => e.id === p.group_restaurant_id))) throw fail();
            // This existing authorized RPC supplies verified coordinates, which
            // its current contract does not obtain from native MapKit tables.
            const verified: SavedLocation[] = [], expected = personal.length + entries.length;
            while (verified.length < expected) {
                const reply = await read(context, (token, s) => supabase.rpc("get_saved_locations", {
                    scope: "all", target_group_id: null, page_size: PAGE, page_offset: verified.length,
                }).setHeader("Authorization", `Bearer ${token}`).abortSignal(s).retry(false));
                if (reply.error || !Array.isArray(reply.data) || !reply.data.length || reply.data.length > PAGE) throw fail();
                verified.push(...reply.data);
                if (verified.length > expected) throw fail();
            }
            const sources: MapSource[] = [];
            for (const record of [...personal.map(p => ({ p, entry: null as Entry | null })),
                ...entries.map(entry => ({ p: facts.find(f => f.id === entry.restaurant_id)!, entry }))]) {
                const { p, entry } = record;
                if (!p?.name?.trim() || !p.address?.trim()) throw fail();
                const kind = entry ? "group" : "personal", id = entry?.id ?? p.id;
                const rows = verified.filter(r => r.saved_kind === kind && r.saved_id === id);
                if (rows.length !== 1 || rows[0].name !== p.name || rows[0].address !== p.address
                    || rows[0].group_id !== (entry?.group_id ?? null)) throw fail();
                const v = rows[0], point = entry ? groupPoints.find(l => l.group_restaurant_id === id)
                    : personalPoints.find(l => l.personal_place_id === id);
                const current = point?.address_snapshot === p.address ? point : null;
                const validVerified = v.resolution_status === "resolved" && ["address", "building"].includes(v.resolution_accuracy ?? "")
                    && validMapCoordinate({ latitude: v.latitude!, longitude: v.longitude! });
                const apple = (entry ?? p as Personal).apple_place_id ?? null;
                if (apple !== null && (typeof apple !== "string" || !apple.trim() || apple !== apple.trim())) throw fail();
                sources.push({ key: `${kind}:${id}`, kind, entryId: id, groupId: entry?.group_id ?? null,
                    label: entry ? before.find(g => g.id === entry.group_id)!.name : "My Places", name: p.name, address: p.address,
                    cuisine: p.cuisine, appleId: apple, structured: current ? normalizeMapKitAddress(current.structured_address) ?? null : null,
                    standardizedAddress: validVerified ? v.standardized_address : null,
                    // Already returned by the authorized location RPC. Never sum
                    // independent destination histories or load notes/visit rows.
                    stats: { visitCount: kind === "group" && Number.isSafeInteger(v.total_visit_count) && v.total_visit_count! >= 0 ? v.total_visit_count : null,
                        rating: Number.isFinite(kind === "personal" ? v.personal_rating : v.group_average_rating)
                            && (kind === "personal" ? v.personal_rating! : v.group_average_rating!) >= 1
                            && (kind === "personal" ? v.personal_rating! : v.group_average_rating!) <= 5
                            ? kind === "personal" ? v.personal_rating : v.group_average_rating : null,
                        ratingKind: kind === "personal" ? "latest" : "average" },
                    coordinate: validVerified ? { latitude: v.latitude!, longitude: v.longitude!, quality: "verified" }
                        : current && validMapCoordinate(current as Point) ? { latitude: current.latitude, longitude: current.longitude, quality: "apple" } : null });
            }
            const after = await collections(context);
            if (JSON.stringify(before) !== JSON.stringify(after)) throw fail();
            await read(context, async () => undefined); // Final account check before publishing.
            return { sources, collections: after };
        } catch { throw fail(); }
        finally { controller.abort(); signal.removeEventListener("abort", abort); deadline.removeEventListener("abort", abort); }
    });
}
