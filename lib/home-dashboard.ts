import { accountAccessToken } from "@/lib/account-session";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import type { DashboardGroupVisit, DashboardPersonalVisit, DashboardRead, DashboardStatus,
    DashboardVisit, HomeDashboardSnapshot } from "@/types/home-dashboard";

export type DashboardReadContext = { userId: string; signal: AbortSignal };
// Reuse this dashboard-specific deadline/account/cancellation boundary for the
// opt-in collection inventory. Shared auth and other workflows are unchanged.
export { read as readDashboardData };
type ReadResult<T> = { data: T | null; error: unknown; count?: number | null };
const unavailable = "Could not load current dashboard data. Refresh to try again.";
const accessUnavailable = "Could not verify current group access. Refresh to try again.";

function dashboardLoading<T>(): DashboardRead<T> { return { status: "loading", data: null, error: null }; }
function dashboardError<T>(error = unavailable): DashboardRead<T> { return { status: "error", data: null, error }; }
function ready<T>(data: T): DashboardRead<T> { return { status: "ready", data, error: null }; }
export function emptyHomeDashboard(): HomeDashboardSnapshot {
    return { places: dashboardLoading(), visits: dashboardLoading(), groups: dashboardLoading(),
        personalRecent: dashboardLoading(), groupRecent: dashboardLoading() };
}

function checkActive(context: DashboardReadContext) {
    if (context.signal.aborted) throw new Error("Dashboard read canceled.");
}

// Every request captures the initiating account's token, including later metadata
// and membership checks. One deadline covers authorization and HTTP together.
async function read<T>(context: DashboardReadContext,
    request: (token: string, signal: AbortSignal) => PromiseLike<ReadResult<T>>) {
    checkActive(context);
    const result = await withRequestDeadline(async deadline => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        context.signal.addEventListener("abort", abort);
        deadline.addEventListener("abort", abort);
        if (context.signal.aborted || deadline.aborted) abort();
        try {
            const token = await accountAccessToken(context.userId);
            // Session retrieval is not abortable. A late result must never send
            // a query after either lifecycle cancellation or deadline expiry.
            if (controller.signal.aborted) throw new Error("Dashboard read canceled.");
            return await request(token, controller.signal);
        }
        finally {
            context.signal.removeEventListener("abort", abort);
            deadline.removeEventListener("abort", abort);
        }
    });
    checkActive(context);
    if (result.error) throw new Error(unavailable);
    return result;
}

function rows<T>(result: ReadResult<T[]>): T[] {
    if (!Array.isArray(result.data)) throw new Error(unavailable);
    return result.data;
}
function exactCount(result: { count?: number | null }): number {
    if (typeof result.count !== "number" || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error(unavailable);
    return result.count;
}
async function section<T>(load: () => Promise<T>, message = unavailable): Promise<DashboardRead<T>> {
    try { return ready(await load()); }
    catch { return dashboardError(message); }
}
const unique = (ids: string[]) => [...new Set(ids)];
function byId<T extends { id: string }>(values: T[]) { return new Map(values.map(value => [value.id, value])); }
function required<T>(value: T | undefined): T {
    if (value === undefined) throw new Error(unavailable);
    return value;
}
function fulfilled<T>(result: PromiseSettledResult<T>): T {
    if (result.status === "rejected") throw result.reason;
    return result.value;
}

async function memberships(context: DashboardReadContext, ids: string[]) {
    if (!ids.length) return [];
    return rows(await read(context, (token, signal) => supabase.from("group_memberships")
        .select("group_id,membership_id").eq("user_id", context.userId).in("group_id", ids).limit(ids.length)
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)));
}
function sameMemberships(expected: { group_id: string; membership_id: string }[],
    current: { group_id: string; membership_id: string }[]) {
    const found = new Map(current.map(value => [value.group_id, value.membership_id]));
    if (expected.some(value => found.get(value.group_id) !== value.membership_id)) throw new Error(accessUnavailable);
}
async function groupFacts(context: DashboardReadContext, ids: string[]) {
    if (!ids.length) return [];
    return rows(await read(context, (token, signal) => supabase.from("groups").select("id,name,owner_user_id")
        .in("id", ids).limit(ids.length).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)));
}

async function personalRecent(context: DashboardReadContext): Promise<DashboardPersonalVisit[]> {
    const visits = rows(await read(context, (token, signal) => supabase.from("personal_visits")
        .select("id,personal_place_id,owner_user_id,origin,visited_on,rating,created_at")
        .eq("owner_user_id", context.userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5)
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)));
    if (!visits.length) return [];
    const ids = unique(visits.map(visit => visit.personal_place_id));
    const places = byId(rows(await read(context, (token, signal) => supabase.from("personal_places")
        .select("id,owner_user_id,name,address").eq("owner_user_id", context.userId).in("id", ids).limit(ids.length)
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false))));
    return visits.map(visit => {
        const place = required(places.get(visit.personal_place_id));
        if (visit.owner_user_id !== context.userId || place.owner_user_id !== context.userId) throw new Error(unavailable);
        return { kind: "personal", visitId: visit.id, entryId: place.id, name: place.name, address: place.address,
            visited_on: visit.visited_on, created_at: visit.created_at, rating: visit.rating, origin: visit.origin };
    });
}

async function groupPreview(context: DashboardReadContext) {
    // Count the account's memberships, not a truncated preview or pending requests.
    const result = await read(context, (token, signal) => supabase.from("group_memberships")
        .select("group_id,membership_id", { count: "exact" }).eq("user_id", context.userId)
        .order("joined_at", { ascending: false }).order("group_id", { ascending: false }).limit(3)
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    const count = exactCount(result), initial = rows(result), ids = initial.map(value => value.group_id);
    const groups = byId(await groupFacts(context, ids));
    return { count, preview: initial.map(membership => {
        const group = required(groups.get(membership.group_id));
        return { id: group.id, name: group.name, role: group.owner_user_id === context.userId ? "Owner" as const : "Member" as const,
            membershipId: membership.membership_id };
    }) };
}

async function groupRecent(context: DashboardReadContext): Promise<DashboardGroupVisit[]> {
    // Discovery carries only identities. Re-read visit content AFTER capturing
    // membership incarnations so removal/rejoining cannot validate old content.
    const candidates = rows(await read(context, (token, signal) => supabase.from("visits").select("id,group_restaurant_id")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5)
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)));
    if (!candidates.length) return [];
    const entryIds = unique(candidates.map(visit => visit.group_restaurant_id));
    const entries = byId(rows(await read(context, (token, signal) => supabase.from("group_restaurants")
        .select("id,group_id,restaurant_id").in("id", entryIds).limit(entryIds.length)
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false))));
    const groupIds = unique(entryIds.map(id => required(entries.get(id)).group_id));
    const initial = await memberships(context, groupIds);
    const membershipIds = new Map(initial.map(value => [value.group_id, value.membership_id]));
    groupIds.forEach(id => required(membershipIds.get(id)));
    const restaurantIds = unique(entryIds.map(id => required(entries.get(id)).restaurant_id));
    const visitIds = candidates.map(value => value.id);
    const [visitResult, restaurantResult, groups] = await Promise.allSettled([
        read(context, (token, signal) => supabase.from("visits").select("id,group_restaurant_id,visited_on,rating,created_at")
            .in("id", visitIds).limit(visitIds.length).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)),
        read(context, (token, signal) => supabase.from("restaurants").select("id,name,address")
            .in("id", restaurantIds).limit(restaurantIds.length).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)),
        groupFacts(context, groupIds),
    ]);
    const visits = byId(rows(fulfilled(visitResult))), restaurants = byId(rows(fulfilled(restaurantResult))), groupMap = byId(fulfilled(groups));
    return candidates.map(candidate => {
        const visit = required(visits.get(candidate.id));
        if (visit.group_restaurant_id !== candidate.group_restaurant_id) throw new Error(unavailable);
        const entry = required(entries.get(visit.group_restaurant_id));
        const restaurant = required(restaurants.get(entry.restaurant_id)), group = required(groupMap.get(entry.group_id));
        return { kind: "group", visitId: visit.id, entryId: entry.id, restaurantId: restaurant.id,
            name: restaurant.name, address: restaurant.address, groupId: group.id, groupName: group.name,
            membershipId: required(membershipIds.get(group.id)), visited_on: visit.visited_on,
            created_at: visit.created_at, rating: visit.rating };
    });
}

export async function readHomeDashboard(context: DashboardReadContext): Promise<HomeDashboardSnapshot> {
    const [places, visits, groups, personal, group] = await Promise.all([
        section(async () => exactCount(await read(context, (token, signal) => supabase.from("personal_places")
            .select("id", { count: "exact", head: true }).eq("owner_user_id", context.userId)
            .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)))),
        section(async () => exactCount(await read(context, (token, signal) => supabase.from("personal_visits")
            .select("id", { count: "exact", head: true }).eq("owner_user_id", context.userId)
            .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false)))),
        section(() => groupPreview(context), accessUnavailable),
        section(() => personalRecent(context)),
        section(() => groupRecent(context), accessUnavailable),
    ]);
    checkActive(context);
    const snapshot = { places, visits, groups, personalRecent: personal, groupRecent: group };
    // Recheck all displayed groups together after both independent branches have
    // finished. This also rejects inconsistent membership/name snapshots.
    try { await verifyDashboardGroups(context, snapshot); }
    catch { checkActive(context); return hideDashboardGroups(snapshot); }
    checkActive(context);
    return snapshot;
}

// One bounded batch per table, at most eight displayed groups. No visit histories
// or counts are polled. Any uncertainty invalidates group content until Refresh.
export async function verifyDashboardGroups(context: DashboardReadContext, snapshot: HomeDashboardSnapshot) {
    const expected = new Map<string, { group_id: string; membership_id: string; name: string; role?: "Owner" | "Member" }>();
    if (snapshot.groups.status === "ready") for (const group of snapshot.groups.data.preview) {
        expected.set(group.id, { group_id: group.id, membership_id: group.membershipId, name: group.name, role: group.role });
    }
    if (snapshot.groupRecent.status === "ready") for (const visit of snapshot.groupRecent.data) {
        const previous = expected.get(visit.groupId);
        if (previous && (previous.membership_id !== visit.membershipId || previous.name !== visit.groupName)) throw new Error(accessUnavailable);
        expected.set(visit.groupId, { ...previous, group_id: visit.groupId, membership_id: visit.membershipId, name: visit.groupName });
    }
    const ids = [...expected.keys()];
    if (!ids.length) return;
    const [current, groups] = await Promise.allSettled([memberships(context, ids), groupFacts(context, ids)]);
    sameMemberships([...expected.values()], fulfilled(current));
    const found = byId(fulfilled(groups));
    for (const value of expected.values()) {
        const group = required(found.get(value.group_id));
        if (group.name !== value.name || (value.role && value.role !== (group.owner_user_id === context.userId ? "Owner" : "Member"))) {
            throw new Error(accessUnavailable);
        }
    }
}

export function hideDashboardGroups(snapshot: HomeDashboardSnapshot): HomeDashboardSnapshot {
    return { ...snapshot, groups: dashboardError(accessUnavailable), groupRecent: dashboardError(accessUnavailable) };
}

function status(parts: DashboardRead<unknown>[]): DashboardStatus {
    if (parts.some(part => part.status === "loading")) return "loading";
    const failures = parts.filter(part => part.status === "error").length;
    return failures === parts.length ? "error" : failures ? "partial" : "ready";
}
function project<T, U>(part: DashboardRead<T>, select: (value: T) => U): DashboardRead<U> {
    return part.status === "ready" ? ready(select(part.data)) : part;
}
function compareCreatedAt(a: string, b: string) {
    const milliseconds = Date.parse(b) - Date.parse(a);
    // PostgreSQL retains microseconds; Date.parse alone would turn distinct
    // instants within one millisecond into an ID tie. Offsets still compare as UTC.
    const fraction = (value: string) => Number((value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(0, 6));
    return milliseconds || fraction(b) - fraction(a);
}
export function homeDashboardView(snapshot: HomeDashboardSnapshot) {
    const entries: DashboardVisit[] = [
        ...(snapshot.personalRecent.status === "ready" ? snapshot.personalRecent.data : []),
        ...(snapshot.groupRecent.status === "ready" ? snapshot.groupRecent.data : []),
    ];
    // Compare instants, not display dates or lexical timezone representations.
    const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    entries.sort((a, b) => compareCreatedAt(a.created_at, b.created_at)
        || compare(b.visitId, a.visitId) || compare(a.kind, b.kind));
    return {
        status: status(Object.values(snapshot)),
        counts: { places: snapshot.places, visits: snapshot.visits, groups: project(snapshot.groups, value => value.count) },
        groups: project(snapshot.groups, value => value.preview),
        recent: { status: status([snapshot.personalRecent, snapshot.groupRecent]), entries: entries.slice(0, 5),
            personalError: snapshot.personalRecent.error, groupError: snapshot.groupRecent.error },
    };
}
