import { supabase } from "@/lib/supabase";

export type PersonalMapPin = { id: string; name: string; address: string; latitude: number; longitude: number };
const PAGE_SIZE = 200;
const FAILURE = "Could not load your map. Check your connection and refresh.";
const ACCOUNT_CHANGED = "Your account changed. Sign in and reopen My Places.";
const uuid = (value: unknown): value is string => typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" &&
    value.trim().length > 0 && Array.from(value).length <= limit;
const coordinate = (value: unknown, bound: number): value is number => typeof value === "number" &&
    Number.isFinite(value) && Math.abs(value) <= bound;

class PersonalMapError extends Error {}
export function personalMapErrorMessage(error: unknown): string {
    return error instanceof PersonalMapError ? error.message : FAILURE;
}

// Read-only: the RPC enforces auth.uid() ownership. No client actor ID, location
// permissions, enrichment calls or persistent cache. Never use shared catalog data.
export async function listPersonalMapPins(userId: string, parent: AbortSignal): Promise<PersonalMapPin[]> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true });
    if (parent.aborted) abort();
    const timer = setTimeout(abort, 10000);
    const active = () => { if (controller.signal.aborted) throw new PersonalMapError(FAILURE); };
    async function sessionToken() {
        active();
        const { data, error } = await supabase.auth.getSession();
        active();
        if (error || !data.session || data.session.user.id !== userId || !data.session.access_token) {
            throw new PersonalMapError(ACCOUNT_CHANGED);
        }
        return data.session.access_token;
    }
    try {
        const token = await sessionToken();
        const pins: PersonalMapPin[] = [], seen = new Set<string>();
        // Migration 8 bounds offsets to 100000. Pagination counts unresolved rows
        // too, so manual places cannot hide resolved rows on later pages.
        for (let offset = 0; offset <= 100000; offset += PAGE_SIZE) {
            await sessionToken();
            const result = await supabase.rpc("get_saved_locations", {
                scope: "personal", target_group_id: null, page_size: PAGE_SIZE, page_offset: offset,
            }).setHeader("Authorization", `Bearer ${token}`).abortSignal(controller.signal).retry(false);
            active();
            if (result.error || !Array.isArray(result.data) || result.data.length > PAGE_SIZE) throw new PersonalMapError(FAILURE);
            for (const row of result.data) {
                if (!row || row.saved_kind !== "personal" || row.restaurant_id !== null || row.group_id !== null || row.group_name !== null ||
                    !uuid(row.saved_id) || seen.has(row.saved_id)) throw new PersonalMapError(FAILURE);
                seen.add(row.saved_id);
                if (row.resolution_status !== "resolved") {
                    if (!["unresolved", "failed", "ambiguous"].includes(row.resolution_status) || row.latitude !== null || row.longitude !== null) {
                        throw new PersonalMapError(FAILURE);
                    }
                    continue;
                }
                if (!text(row.name, 100) || !text(row.address, 300) || !text(row.standardized_address, 300) ||
                    !["building", "address"].includes(String(row.resolution_accuracy)) ||
                    !coordinate(row.latitude, 90) || !coordinate(row.longitude, 180)) throw new PersonalMapError(FAILURE);
                pins.push({ id: row.saved_id, name: row.name, address: row.address, latitude: row.latitude, longitude: row.longitude });
            }
            if (result.data.length < PAGE_SIZE) {
                await sessionToken(); // An in-flight account change must not publish the old user's pins.
                return pins;
            }
        }
        throw new PersonalMapError(FAILURE);
    } catch (error) {
        throw error instanceof PersonalMapError ? error : new PersonalMapError(FAILURE);
    } finally {
        clearTimeout(timer);
        parent.removeEventListener("abort", abort);
    }
}
