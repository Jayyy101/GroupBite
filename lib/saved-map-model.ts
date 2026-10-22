import { destinationHref, type DetailOrigin } from "@/lib/restaurant-navigation";
import type { MapCoordinate, MapRegion, MapRestaurant, MapSource } from "@/types/saved-map";

const normalized = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
export function validMapCoordinate(value: MapCoordinate): boolean {
    return Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
        && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180
        && (value.latitude !== 0 || value.longitude !== 0);
}
function rawAddress(value: string) {
    const parts = value.split(",").map(normalized);
    const country = parts.at(-1);
    const code = ["us", "usa", "united states", "united states of america"].includes(country ?? "") ? "us"
        : ["ca", "can", "canada"].includes(country ?? "") ? "ca" : null;
    if (!code || ![3, 4].includes(parts.length)) return null;
    const postal = code === "us" ? "\\d{5}(?:-\\d{4})?" : "[a-z]\\d[a-z] ?\\d[a-z]\\d";
    const match = parts[parts.length - 2].match(new RegExp(`^${parts.length === 3 ? "(.+?) " : ""}([a-z]{2}) (${postal})$`));
    if (!match || !/^\d[\p{L}\d/-]*\s+[\p{L}]/u.test(parts[0])) return null;
    return [parts[0], parts.length === 3 ? match[1] : parts[1], match[parts.length === 3 ? 2 : 1],
        match[parts.length === 3 ? 3 : 2].replace(/\s/g, ""), code];
}
export function savedRestaurantAddressKey(source: MapSource) {
    const s = source.structured;
    const structured = s?.street && s.city && s.region && s.postal_code && s.country_code
        ? [s.street, s.city, s.region, s.postal_code.replace(/\s/g, ""), s.country_code].map(normalized) : null;
    const raw = rawAddress(source.address);
    // Never let selected metadata contradict a recognized current saved address.
    if (raw && structured && JSON.stringify(raw) !== JSON.stringify(structured)) return null;
    const address = structured ?? raw;
    return address ? JSON.stringify(address) : null;
}
function distance(a: MapCoordinate, b: MapCoordinate) {
    const rad = (n: number) => n * Math.PI / 180;
    const d = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
        + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, d)));
}
function compatibleCoordinates(sources: MapSource[]) {
    const points = sources.flatMap(s => s.coordinate ? [s.coordinate] : []);
    return points.every(a => points.every(b => distance(a, b) <= 100));
}

// Presentation identity only. Never merge database entries, visits or permissions.
// Opaque Apple IDs are exact; ID-less copies cannot bridge conflicting IDs.
export function groupMapRestaurants(sources: readonly MapSource[]): MapRestaurant[] {
    const sorted = [...sources].sort((a, b) => a.key.localeCompare(b.key));
    const venue = (s: MapSource) => { const address = savedRestaurantAddressKey(s); return address ? JSON.stringify([normalized(s.name), address]) : null; };
    const byApple = new Map<string, MapSource[]>();
    const idsByVenue = new Map<string, Set<string>>();
    for (const s of sorted) {
        if (!s.appleId) continue;
        byApple.set(s.appleId, [...(byApple.get(s.appleId) ?? []), s]);
        const key = venue(s);
        if (key) idsByVenue.set(key, new Set([...(idsByVenue.get(key) ?? []), s.appleId]));
    }
    const badIds = new Set([...byApple].filter(([, rows]) => !venue(rows[0])
        || rows.some(s => venue(s) !== venue(rows[0])) || !compatibleCoordinates(rows)).map(([id]) => id));
    const buckets = new Map<string, MapSource[]>();
    for (const s of sorted) {
        const v = venue(s), ids = v ? idsByVenue.get(v) : undefined;
        const id = s.appleId ?? (ids?.size === 1 ? [...ids][0] : null);
        const key = id && !badIds.has(id) ? `apple:${id}`
            : !s.appleId && v && !ids?.size ? `venue:${v}` : `source:${s.key}`;
        buckets.set(key, [...(buckets.get(key) ?? []), s]);
    }
    const result: MapRestaurant[] = [];
    for (const [key, rows] of buckets) {
        // A missing-ID copy with a conflicting point must not contaminate a
        // previously consistent Apple bucket. Split rather than average/guess.
        const split = !compatibleCoordinates(rows);
        for (const group of split ? rows.map(row => [row]) : [rows]) {
            const representative = [...group].sort((a, b) => Number(b.coordinate?.quality === "verified")
                - Number(a.coordinate?.quality === "verified") || a.key.localeCompare(b.key))[0];
            const point = representative.coordinate ?? group.find(s => s.coordinate)?.coordinate ?? null;
            result.push({ key: split ? `source:${group[0].key}` : key, name: representative.name,
                address: representative.address, cuisine: representative.cuisine, sources: group,
                coordinate: point ? { latitude: point.latitude, longitude: point.longitude } : null,
                ambiguous: split || group.some(s => !!s.appleId && badIds.has(s.appleId)) });
        }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export function filterMapRestaurants(restaurants: readonly MapRestaurant[], filter: string) {
    // Regroup only eligible sources: a filter cannot borrow another collection's
    // coordinates, labels or source-only identity evidence.
    return groupMapRestaurants(restaurants.flatMap(r => r.sources).filter(s => filter === "all"
        || (filter === "personal" ? s.kind === "personal" : s.groupId === filter)));
}
export function inMapRegion(point: MapCoordinate, region: MapRegion) {
    const longitude = ((point.longitude - region.longitude + 540) % 360) - 180;
    return Math.abs(point.latitude - region.latitude) <= region.latitudeDelta / 2
        && Math.abs(longitude) <= region.longitudeDelta / 2;
}
export function mapSourceHref(source: MapSource, origin: DetailOrigin = "map") {
    return destinationHref({ destination_kind: source.kind, group_id: source.groupId,
        entry_id: source.entryId, visit_id: null, available: true }, origin);
}
