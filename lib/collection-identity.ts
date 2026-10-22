import { groupMapRestaurants, savedRestaurantAddressKey } from "@/lib/saved-map-model";
import type { MapSource } from "@/types/saved-map";
import type { CollectionMetric, CollectionPlace } from "@/types/collection-statistics";

const normalized = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const US_REGIONS = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const CA_REGIONS = new Set("AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" "));

// Deliberately a supported-format recognizer, not a general geocoder. Require
// explicit country, region and postcode; never infer them from search defaults,
// coordinates, a comma position, or a bare city. Unsupported formats stay unknown.
export function identifyCollectionAddress(address: string) {
    const parts = address.normalize("NFC").trim().split(",").map(value => value.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    const countryName = normalized(parts.at(-1)!);
    const country = ["us", "usa", "united states", "united states of america"].includes(countryName) ? "US"
        : ["ca", "can", "canada"].includes(countryName) ? "CA" : null;
    if (!country) return null;
    const regionPostal = country === "US" ? "([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)" : "([A-Z]{2})\\s+([A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d)";
    const match = parts[parts.length - 2].match(new RegExp(`^${parts.length === 3 ? "(.+?)\\s+" : ""}${regionPostal}$`, "i"));
    if (!match) return null;
    const region = match[parts.length === 3 ? 2 : 1].toUpperCase();
    const postal = match[parts.length === 3 ? 3 : 2].toUpperCase().replace(/\s/g, "");
    if (!(country === "US" ? US_REGIONS : CA_REGIONS).has(region)) return null;
    const city = normalized(parts.length === 3 ? match[1] : parts[1]);
    if (!/^[\p{L}][\p{L} .'-]*$/u.test(city) || ["unknown", "n/a", "na", "null", "none", "not recorded"].includes(city)) return null;
    const street = normalized(parts[0]);
    // Requiring a numbered premise is intentionally conservative. Rural,
    // unnumbered, PO-box and extra-component addresses are not guessed.
    if (!/^\d[\p{L}\d/-]*\s+[\p{L}]/u.test(street)) return null;
    const cityKey = JSON.stringify([country, region, city]);
    return { cityKey, premise: street.split(" ")[0], postal, addressKey: JSON.stringify([street, cityKey, postal]) };
}

export function collectionMetric(status: CollectionMetric["status"], value: number | null = null,
    reason: CollectionMetric["reason"] = null, knownCount: number | null = null, unresolvedRecords: number | null = null): CollectionMetric {
    return { status, value: status === "ready" ? value : null, knownCount: status === "ready" ? value : knownCount,
        unresolvedRecords: status === "ready" ? 0 : unresolvedRecords, reason };
}

export function calculateCollectionLocations(places: readonly CollectionPlace[]) {
    const sources: MapSource[] = places.map((place, i) => ({ key: `${place.kind}:${place.sourceId}:${i}`, kind: place.kind,
        entryId: place.sourceId, groupId: null, label: "", name: place.name, address: place.address, cuisine: null,
        appleId: place.applePlaceId, structured: place.structured ?? null, standardizedAddress: place.verifiedAddress,
        coordinate: place.coordinate ?? null }));
    const rows = places.map((place, i) => {
        const raw = identifyCollectionAddress(place.address);
        const verified = place.verifiedAddress === null ? null : identifyCollectionAddress(place.verifiedAddress);
        const address = verified ?? raw;
        const name = normalized(place.name), physicalAddress = savedRestaurantAddressKey(sources[i]);
        return { place, name, address, city: collectionCity(place),
            key: name && physicalAddress ? JSON.stringify([name, physicalAddress]) : null };
    });
    const conflicting = new Set<number>();
    const byApple = new Map<string, number[]>(), byAddress = new Map<string, number[]>(), byVenue = new Map<string, number[]>();
    function collect(map: Map<string, number[]>, key: string, index: number) {
        const indices = map.get(key) ?? []; indices.push(index); map.set(key, indices);
    }
    rows.forEach((row, i) => {
        if (row.place.applePlaceId !== null) collect(byApple, row.place.applePlaceId, i); // opaque, exact comparison
        if (row.address) collect(byAddress, row.address.addressKey, i);
        if (row.key) collect(byVenue, row.key, i);
        // A known locality disagreement between entered and verified addresses
        // cannot certify either collective total.
        const raw = identifyCollectionAddress(row.place.address);
        const verified = row.place.verifiedAddress === null ? null : identifyCollectionAddress(row.place.verifiedAddress);
        if (raw && verified && (raw.cityKey !== verified.cityKey || raw.premise !== verified.premise || raw.postal !== verified.postal)) conflicting.add(i);
    });
    for (const indices of byApple.values()) {
        // An ID with missing or inconsistent corroboration is not permission to
        // merge different branches, business names, units or address variants.
        if (new Set(indices.map(i => rows[i].key)).size !== 1 || indices.some(i => rows[i].key === null)) indices.forEach(i => conflicting.add(i));
    }
    for (const indices of byVenue.values()) {
        const ids = new Set(indices.map(i => rows[i].place.applePlaceId).filter(id => id !== null));
        if (ids.size > 1) indices.forEach(i => conflicting.add(i)); // NULL-ID copies cannot bridge conflicts
    }
    for (const indices of byAddress.values()) {
        if (new Set(indices.map(i => rows[i].name)).size > 1 && indices.some(i => rows[i].place.applePlaceId === null)) {
            indices.forEach(i => conflicting.add(i)); // possible rename/co-location with insufficient identity
        }
    }
    const grouped = groupMapRestaurants(sources);
    const ambiguous = new Set(grouped.filter(row => row.ambiguous).flatMap(row => row.sources.map(s => s.key)));
    const unresolvedPlaces = rows.filter((row, i) => row.key === null || conflicting.has(i) || ambiguous.has(sources[i].key)).length;
    const cities = new Set(rows.flatMap((row, i) => row.city && !conflicting.has(i) ? [row.city] : []));
    const unresolvedCities = rows.filter((row, i) => row.city === null || conflicting.has(i)).length;
    return {
        placesSaved: unresolvedPlaces ? collectionMetric("incomplete", null, "identity", null, unresolvedPlaces)
            : collectionMetric("ready", grouped.length),
        citiesExplored: unresolvedCities ? collectionMetric("incomplete", null, "city", cities.size, unresolvedCities)
            : collectionMetric("ready", cities.size),
    };
}

// Apple-selected components are informational facts, not Geoapify verification.
// Raw display addresses never supply a city. Only an explicit, current resolved
// provider address may use the narrow supported-format recognizer above.
function collectionCity(place: CollectionPlace): string | null {
    const s = place.structured;
    const city = s?.city ? normalized(s.city) : null;
    const country = s?.country_code;
    const aliases: Record<string, string> = { california: "CA", illinois: "IL", massachusetts: "MA", ontario: "ON" };
    const region = s?.region ? aliases[normalized(s.region)] ?? normalized(s.region).toUpperCase() : null;
    const apple = city && !["unknown", "n/a", "null", "none", "not recorded"].includes(city)
        && country && region && !["UNKNOWN", "N/A", "NA", "NULL", "NONE"].includes(region) ? JSON.stringify([country, region, city]) : null;
    const verified = place.verifiedAddress ? identifyCollectionAddress(place.verifiedAddress)?.cityKey ?? null : null;
    const raw = identifyCollectionAddress(place.address)?.cityKey ?? null;
    // Even partial Apple facts may contradict an otherwise usable fallback.
    // Missing components are not permission to ignore a known disagreement.
    for (const key of [verified, raw]) if (key) {
        const [otherCountry, otherRegion, otherCity] = JSON.parse(key) as [string, string, string];
        if ((country && country !== otherCountry) || (region && region !== otherRegion)
            || (city && !["unknown", "n/a", "null", "none", "not recorded"].includes(city) && city !== otherCity)) return null;
    }
    return apple ?? verified;
}
