// Temporary development-only tooling. No restaurant/visit writes, provider-ID
// changes, persisted drafts, service credentials or mutation retries.
import { accountAccessToken } from "@/lib/account-session";
import { listPersonalMapPins, type PersonalMapPin } from "@/lib/personal-map";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import { normalizeMapKitAddress, type MapKitAddress } from "@/lib/mapkit-address";
import type { AddRestaurant, PersonalPlace, PersonalVisit } from "@/types/database";

// Set false before friends testing; the helper also refuses dispatch when off.
export const DEV_PERSONAL_LOCATION_REPAIR_ENABLED = true;
export type RepairSnapshot = { place: PersonalPlace; visits: PersonalVisit[]; pin?: PersonalMapPin; address?: MapKitAddress };
export type RepairReview = { status: "missing" | "present" | "confirmed" | "pending" | "uncertain" | "changed"; snapshot?: RepairSnapshot };
type Point = NonNullable<AddRestaurant["mapkit_point"]>;
type Attempt = { baseline: RepairSnapshot; point: Point; pending: boolean };
// Retain dispatched uncertainty across disposable detail screens and account
// switches. Nothing is replayed automatically. A reload always reads locations
// before offering repair; the RPC also enforces first-resolution-wins.
const attempts = new Map<string, Attempt>();
const key = (userId: string, id: string) => JSON.stringify([userId, id]);
const sameRow = (a: object, b: object) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const sameHistory = (a: PersonalVisit[], b: PersonalVisit[]) => a.length === b.length && a.every(visit => {
    const other = b.find(row => row.id === visit.id);
    return !!other && sameRow(visit, other);
});
function developmentOnly() {
    if (!__DEV__ || !DEV_PERSONAL_LOCATION_REPAIR_ENABLED) throw new Error("Location repair is available only in development builds.");
}

async function snapshot(userId: string, expected: PersonalPlace): Promise<RepairSnapshot> {
    developmentOnly();
    const token = await accountAccessToken(userId);
    const result = await withRequestDeadline(signal => supabase.from("personal_places").select("*")
        .eq("owner_user_id", userId).eq("id", expected.id).setHeader("Authorization", `Bearer ${token}`)
        .abortSignal(signal).retry(false).maybeSingle());
    if (result.error || !result.data || result.data.owner_user_id !== userId || expected.owner_user_id !== userId
        || result.data.id !== expected.id) throw new Error("Could not verify the original personal restaurant.");
    // Read the full history even if PostgREST's row cap is smaller than our page.
    const visits: PersonalVisit[] = [];
    let after: string | undefined;
    while (true) {
        const pageToken = await accountAccessToken(userId);
        const query = supabase.from("personal_visits").select("*").eq("owner_user_id", userId)
            .eq("personal_place_id", expected.id).order("id").limit(500).setHeader("Authorization", `Bearer ${pageToken}`);
        if (after) query.gt("id", after);
        const page = await withRequestDeadline(signal => query.abortSignal(signal).retry(false));
        if (page.error || !Array.isArray(page.data)) throw new Error("Could not verify visit history.");
        if (!page.data.length) break;
        const lastId = page.data[page.data.length - 1].id;
        if (after && lastId <= after) throw new Error("Could not verify visit history.");
        visits.push(...page.data); after = lastId;
    }
    if (visits.some(visit => visit.owner_user_id !== userId || visit.personal_place_id !== expected.id)) throw new Error("Could not verify visit ownership.");
    const pins = await listPersonalMapPins(userId, new AbortController().signal);
    const locationToken = await accountAccessToken(userId);
    const savedAddress = result.data.address;
    const location = await withRequestDeadline(signal => supabase.rpc("get_saved_mapkit_location", {
        target_kind: "personal", target_entry_id: expected.id, expected_address: savedAddress,
    }).setHeader("Authorization", `Bearer ${locationToken}`).abortSignal(signal).retry(false));
    if (location.error) throw new Error("Could not verify saved Apple Maps details.");
    const address = normalizeMapKitAddress(location.data?.structured_address);
    await accountAccessToken(userId);
    return { place: result.data, visits, pin: pins.find(pin => pin.id === expected.id), address };
}

export async function reviewPersonalLocationRepair(userId: string, expected: PersonalPlace): Promise<RepairReview> {
    const current = await snapshot(userId, expected), attempt = attempts.get(key(userId, expected.id));
    if (attempt?.pending) return { status: "pending" };
    if (!sameRow(current.place, attempt?.baseline.place ?? expected)
        || (attempt && !sameHistory(current.visits, attempt.baseline.visits))) return { status: "changed" };
    if (attempt) {
        const details = attempt.point.structured_address;
        if (current.pin?.latitude === attempt.point.latitude && current.pin?.longitude === attempt.point.longitude
            && (!details || Object.entries(details).every(([field,value]) => value === null || current.address?.[field as keyof MapKitAddress] === value))) {
            return { status: "confirmed", snapshot: current };
        }
        // A missing point is NOT proof that a timed-out transaction rolled back.
        // A different point is never overwritten. Both require read-only review.
        return { status: "uncertain" };
    }
    return { status: current.pin ? "present" : "missing", snapshot: current };
}

export async function attachPersonalMapkitLocation(userId: string, baseline: RepairSnapshot, selection: AddRestaurant,
    canSend: () => boolean): Promise<RepairReview> {
    developmentOnly();
    const point = selection.mapkit_point, attemptKey = key(userId, baseline.place.id);
    if (!point || point.name !== selection.name || point.address !== selection.address
        || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90
        || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180
        || (point.latitude === 0 && point.longitude === 0)) throw new Error("Select a fresh Apple Maps restaurant location.");
    if (baseline.place.owner_user_id !== userId || attempts.has(attemptKey)) throw new Error("Check the existing repair before continuing.");
    const details = normalizeMapKitAddress(point.structured_address);
    const attempt: Attempt = { baseline, point: Object.freeze({ ...point, structured_address: details }), pending: true };
    attempts.set(attemptKey, attempt); // synchronous lock, including preflight
    let dispatched = false;
    try {
        const current = await snapshot(userId, baseline.place);
        if (!sameRow(current.place, baseline.place) || !sameHistory(current.visits, baseline.visits)) return { status: "changed" };
        if (current.pin) return { status: "present", snapshot: current };
        const token = await accountAccessToken(userId);
        if (!canSend()) throw new Error("Repair paused before sending. Select the restaurant again.");
        dispatched = true;
        // Whitelist only location-only arguments. Never call an Add/visit RPC.
        await withRequestDeadline(signal => supabase.rpc("set_personal_mapkit_location_with_address", {
            target_personal_place_id: baseline.place.id, expected_revision: baseline.place.revision,
            expected_address: baseline.place.address, selected_latitude: point.latitude, selected_longitude: point.longitude,
            selected_address: details ?? null,
        }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
        // Even a successful/false/malformed response needs the same readback.
    } catch (error) {
        if (!dispatched) throw error;
    } finally {
        attempt.pending = false;
        if (!dispatched) attempts.delete(attemptKey);
    }
    try { return await reviewPersonalLocationRepair(userId, baseline.place); }
    catch { return { status: "uncertain" }; }
}
