import { AddressSearchError, GEOAPIFY_ATTRIBUTION, GEOAPIFY_AUTOCOMPLETE_ENABLED } from "./address-search";
import type { AddressSearch, GeoapifyAddressSuggestion } from "./address-search";

// A getter over the current Auth-provider session, not a decoded JWT or stored
// token copy. It must reflect sign-out/account changes without making requests.
export type AddressSearchSession = Readonly<{
    access_token: string;
    user: Readonly<{ id: string; is_anonymous?: boolean }>;
    expires_at?: number;
}>;
type Options = {
    supabaseUrl: string;
    publishableKey: string;
    getSession: () => AddressSearchSession | null;
    fetch?: typeof fetch;
    now?: () => number;
};
const maxBytes = 65536;
const maxRetrySeconds = 86401;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value === value.trim() &&
    [...value].length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

function retrySeconds(value: string | null, now: number): number {
    if (value && /^\d+$/.test(value)) return Math.max(1, Math.min(maxRetrySeconds, Number(value)));
    const time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? Math.max(1, Math.min(maxRetrySeconds, Math.ceil((time - now) / 1000))) : 60;
}

function suggestions(data: unknown, now: number): readonly GeoapifyAddressSuggestion[] {
    if (!object(data) || !Array.isArray(data.suggestions) || data.suggestions.length > 5 || !object(data.attribution)) {
        throw new AddressSearchError("invalid_response");
    }
    const attribution = data.attribution;
    if (Object.entries(GEOAPIFY_ATTRIBUTION).some(([key, value]) => attribution[key] !== value)) throw new AddressSearchError("invalid_response");
    const ids = new Set<string>();
    return data.suggestions.map(row => {
        if (!object(row) || !text(row.id, 300) || !text(row.address, 300) || row.source !== "geoapify" ||
            row.accuracy !== "building" || row.countryCode !== "us" ||
            typeof row.latitude !== "number" || !Number.isFinite(row.latitude) || Math.abs(row.latitude) > 90 ||
            typeof row.longitude !== "number" || !Number.isFinite(row.longitude) || Math.abs(row.longitude) > 180 ||
            (row.latitude === 0 && row.longitude === 0) || typeof row.selectionReceipt !== "string" ||
            row.selectionReceipt.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(row.selectionReceipt) ||
            typeof row.expiresAt !== "string" || row.expiresAt.length > 40 ||
            !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= now || ids.has(row.id)) {
            throw new AddressSearchError("invalid_response");
        }
        ids.add(row.id);
        // Preserve original receipt/address/expiry exactly; no decoding, signing,
        // persistence or location-attachment RPC is available in this adapter.
        return Object.freeze({ id: row.id, source: "geoapify", address: row.address, latitude: row.latitude,
            longitude: row.longitude, accuracy: "building", countryCode: "us",
            selectionReceipt: row.selectionReceipt, expiresAt: row.expiresAt });
    });
}

export function createGeoapifyAddressSearch(options: Options): AddressSearch {
    const fetcher = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    let blockedUntil = 0;
    return async (query, parent) => {
        // Gate precedes configuration, session lookup and all networking.
        if (!GEOAPIFY_AUTOCOMPLETE_ENABLED) throw new AddressSearchError("disabled");
        if (parent.aborted) throw new AddressSearchError("cancelled");
        query = query.trim();
        if (!text(query, 300) || [...query].length < 3) throw new AddressSearchError("invalid_query");
        let endpoint: URL;
        try {
            const origin = new URL(options.supabaseUrl);
            if (origin.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(origin.hostname) ||
                origin.port || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
                !/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey)) throw new Error();
            endpoint = new URL("/functions/v1/geoapify-suggest", origin);
        } catch { throw new AddressSearchError("unconfigured"); }
        if (blockedUntil > now()) throw new AddressSearchError("rate_limited", Math.ceil((blockedUntil - now()) / 1000));

        const controller = new AbortController();
        let rejectAbort: (error: AddressSearchError) => void = () => {};
        const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
        const abort = () => { controller.abort(); rejectAbort(new AddressSearchError("cancelled")); };
        const timer = setTimeout(() => { controller.abort(); rejectAbort(new AddressSearchError("timeout")); }, 15000);
        parent.addEventListener("abort", abort, { once: true });
        const active = () => { if (controller.signal.aborted || parent.aborted) throw new AddressSearchError("cancelled"); };
        try {
            active();
            return await Promise.race([cancelled, (async () => {
                const session = options.getSession();
                if (!session || !uuid.test(session.user.id) || session.user.is_anonymous === true ||
                    !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(session.access_token) ||
                    session.access_token.length > 8192 ||
                    (session.expires_at !== undefined && (!Number.isFinite(session.expires_at) || session.expires_at * 1000 <= now()))) {
                    throw new AddressSearchError("authentication");
                }
                const userId = session.user.id, token = session.access_token;
                const response = await fetcher(endpoint, { method: "POST", redirect: "error", signal: controller.signal,
                    headers: { "Content-Type": "application/json", apikey: options.publishableKey, Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "suggest", query }) });
                active();
                const current = options.getSession();
                if (!current || current.user.id !== userId || current.access_token !== token) throw new AddressSearchError("account_changed");
                if (response.status === 401) throw new AddressSearchError("authentication");
                if (response.status === 403) throw new AddressSearchError("access_denied");
                const retry = response.headers.get("Retry-After");
                if (response.status === 429 || (response.status === 503 && retry !== null)) {
                    const seconds = retrySeconds(retry, now());
                    blockedUntil = Math.max(blockedUntil, now() + seconds * 1000);
                    throw new AddressSearchError("rate_limited", seconds);
                }
                if (!response.ok) throw new AddressSearchError("unavailable");
                if (response.headers.get("Content-Type")?.toLowerCase().split(";")[0].trim() !== "application/json") throw new AddressSearchError("invalid_response");
                const length = response.headers.get("Content-Length");
                if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new AddressSearchError("invalid_response");
                // Native Fetch's text() works on RN versions without streaming bodies.
                const raw = await response.text(); active();
                let bytes = 0;
                for (const character of raw) { const cp = character.codePointAt(0)!; bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4; if (bytes > maxBytes) throw new AddressSearchError("invalid_response"); }
                const afterBody = options.getSession();
                if (!afterBody || afterBody.user.id !== userId || afterBody.access_token !== token) throw new AddressSearchError("account_changed");
                let data: unknown;
                try { data = JSON.parse(raw); } catch { throw new AddressSearchError("invalid_response"); }
                return suggestions(data, now());
            })()]);
        } catch (error) {
            throw error instanceof AddressSearchError ? error : new AddressSearchError("unavailable");
        } finally {
            clearTimeout(timer); parent.removeEventListener("abort", abort); controller.abort();
        }
    };
}
