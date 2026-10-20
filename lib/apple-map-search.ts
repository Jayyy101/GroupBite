import { getMapKitSearchModule, type AppleSearchLocation, type AppleSearchMode, type AppleSearchSuggestion,
    type MapKitSearchModule } from "@/modules/groupbite-mapkit-search";
import { traceSearch } from "@/lib/search-diagnostics";

export type { AppleSearchLocation, AppleSearchMode, AppleSearchSuggestion } from "@/modules/groupbite-mapkit-search";
export const CHIPOTLE_COMPARISON_ID = "8b6fdcaf-5915-4d13-811b-bf62a9c87ac3";
export const CHIPOTLE_SEARCH = "Chipotle Mexican Grill, 2760 Mowry Avenue, Fremont, CA";
const UNAVAILABLE = "Apple search is unavailable. Try again explicitly when connected.";
let sequence = 0;
export class AppleSearchError extends Error {
    constructor(public readonly kind: "unavailable" | "invalid" | "cancelled" | "timeout", message: string) { super(message); }
}
export function appleSearchErrorMessage(error: unknown): string {
    return error instanceof AppleSearchError ? error.message : UNAVAILABLE;
}
export const appleSearchAvailable = () => getMapKitSearchModule() !== null;
function supportsPlaceIdLookup(native: MapKitSearchModule): boolean {
    try {
        return typeof native.lookupPlace === "function" && typeof native.supportsPlaceIdLookup === "function" && native.supportsPlaceIdLookup() === true;
    } catch { return false; }
}
export function applePlaceIdLookupAvailable(): boolean {
    const native = getMapKitSearchModule();
    return native !== null && supportsPlaceIdLookup(native);
}
const text = (value: unknown, limit: number, empty = false): value is string => typeof value === "string" &&
    (empty || value.trim().length > 0) && Array.from(value).length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,20}:[0-4]$/.test(value);
// Opaque provider reference, distinct from the temporary request:index handle.
// Never trim, truncate, change case or assume the format of Apple's example IDs.
const placeId = (value: unknown): value is string => text(value, 300) && value === value.trim() && !/[\u007f-\u009f]/.test(value);
const coordinate = (value: unknown, bound: number): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= bound;
function nativeError(error: unknown): AppleSearchError {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ERR_TIMEOUT") return new AppleSearchError("timeout", "Apple search timed out. Try again explicitly.");
    if (code === "ERR_CANCELLED") return new AppleSearchError("cancelled", "Apple search cancelled.");
    if (code === "ERR_INVALID") return new AppleSearchError("invalid", "Check the search text or select a current suggestion.");
    if (code === "ERR_DISABLED") return new AppleSearchError("unavailable", "Apple search requires the local iOS debug build.");
    if (code === "ERR_UNSUPPORTED") return new AppleSearchError("unavailable", "Place ID lookup requires iOS 18 or later and an updated local debug build.");
    return new AppleSearchError("unavailable", UNAVAILABLE);
}
function validateQuery(query: string, mode: AppleSearchMode): string {
    query = query.trim();
    if (!text(query, 200) || Array.from(query).length < 3 || !["business", "address"].includes(mode)) {
        throw new AppleSearchError("invalid", "Enter 3–200 characters and choose Businesses or Addresses.");
    }
    return query;
}

async function operation(action: "complete" | "search" | "resolve" | "lookup", invoke: (native: MapKitSearchModule, requestId: string) => Promise<unknown>, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new AppleSearchError("cancelled", "Apple search cancelled.");
    const native = getMapKitSearchModule();
    if (!native) throw new AppleSearchError("unavailable", "Apple search requires the local iOS debug build; Expo Go is not supported.");
    const requestId = String(++sequence);
    const trace = (event: string, data: Record<string, number | boolean | null> = {}) => traceSearch(`adapter:${action}:${event}`, { request: Number(requestId), ...data });
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (error?: AppleSearchError, value?: unknown) => {
            if (done) return;
            done = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
            trace(error ? `finish:${error.kind}` : "finish:success");
            if (error) { void native.cancel(requestId).catch(() => {}); reject(error); }
            else resolve(value);
        };
        const abort = () => finish(new AppleSearchError("cancelled", "Apple search cancelled."));
        const timer = setTimeout(() => finish(new AppleSearchError("timeout", "Apple search timed out. Try again explicitly.")), 10000);
        signal.addEventListener("abort", abort, { once: true });
        try {
            trace("dispatch");
            invoke(native, requestId).then(value => {
                trace("native-reply", { settled: done, aborted: signal.aborted, count: Array.isArray(value) ? value.length : -1 });
                return signal.aborted ? abort() : finish(undefined, value);
            }, error => { const mapped = nativeError(error); trace(`native-error:${mapped.kind}`, { settled: done }); finish(mapped); });
        } catch (error) { finish(nativeError(error)); }
    });
}

export async function completeAppleSearch(query: string, mode: AppleSearchMode, signal: AbortSignal): Promise<AppleSearchSuggestion[]> {
    query = validateQuery(query, mode);
    const result = await operation("complete", (native, requestId) => native.complete(query, mode, requestId), signal);
    if (!Array.isArray(result) || result.length > 5) throw new AppleSearchError("unavailable", UNAVAILABLE);
    const seen = new Set<string>();
    return result.map(row => {
        if (!row || !id(row.id) || seen.has(row.id) || !text(row.title, 200) || !text(row.subtitle, 500, true)) {
            throw new AppleSearchError("unavailable", UNAVAILABLE);
        }
        seen.add(row.id); return { id: row.id, title: row.title, subtitle: row.subtitle };
    });
}

export async function resolveAppleSuggestion(suggestionId: string, signal: AbortSignal): Promise<AppleSearchLocation[]> {
    if (!id(suggestionId)) throw new AppleSearchError("invalid", "Select a current suggestion.");
    const result = await operation("resolve", (native, requestId) => native.resolve(suggestionId, requestId), signal);
    return locations(result);
}

export async function searchApplePlaces(query: string, mode: AppleSearchMode, signal: AbortSignal): Promise<AppleSearchLocation[]> {
    query = validateQuery(query, mode);
    const result = await operation("search", (native, requestId) => native.search(query, mode, requestId), signal);
    return locations(result);
}

export async function lookupApplePlace(placeIdentifier: string, mode: AppleSearchMode, signal: AbortSignal): Promise<AppleSearchLocation[]> {
    if (!placeId(placeIdentifier) || !["business", "address"].includes(mode)) {
        throw new AppleSearchError("invalid", "Select a location with a valid Apple Place ID.");
    }
    const result = await operation("lookup", (native, requestId) => {
        if (!supportsPlaceIdLookup(native)) throw { code: "ERR_UNSUPPORTED" };
        return native.lookupPlace!(placeIdentifier, mode, requestId);
    }, signal);
    if (!Array.isArray(result) || result.length > 1) throw new AppleSearchError("unavailable", UNAVAILABLE);
    return locations(result);
}

function locations(result: unknown): AppleSearchLocation[] {
    if (!Array.isArray(result) || result.length > 5) throw new AppleSearchError("unavailable", UNAVAILABLE);
    const seen = new Set<string>();
    return result.map(row => {
        if (!row || !id(row.id) || seen.has(row.id) || !text(row.name, 200) || !text(row.address, 500) || row.source !== "apple-maps-preview" ||
            !["business", "address"].includes(row.kind) || !coordinate(row.latitude, 90) || !coordinate(row.longitude, 180) ||
            (row.latitude === 0 && row.longitude === 0) || (row.placeId !== undefined && row.placeId !== null && !placeId(row.placeId))) {
            throw new AppleSearchError("unavailable", UNAVAILABLE);
        }
        seen.add(row.id);
        return { id: row.id, ...(typeof row.placeId === "string" ? { placeId: row.placeId } : {}),
            name: row.name, address: row.address, latitude: row.latitude, longitude: row.longitude, source: row.source, kind: row.kind };
    });
}

export function resetAppleSearch(): void {
    const native = getMapKitSearchModule();
    if (native) {
        traceSearch("adapter:reset-dispatch");
        void native.reset().then(() => traceSearch("adapter:reset-complete"), () => traceSearch("adapter:reset-error"));
    }
}

export function pinDistanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
    const radians = (value: number) => value * Math.PI / 180;
    const value = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
        Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
    return Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value)))));
}
