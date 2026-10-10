import { deadline, HttpError, object, readJson, text, uuid } from "./http.ts";
import { createReceiptCodec, type VerifiedSelection } from "./receipts.ts";

export type SuggestConfig = {
    supabaseUrl: string;
    anonKey: string;
    serviceRoleKey: string;
    geoapifyKey: string;
    selectionSecret: string;
    // Temporary rollout restriction. Required until explicitly removed in code.
    allowedUserId: string;
};
type Dependencies = {
    fetch?: typeof fetch;
    now?: () => number;
    monotonicNow?: () => number;
    crypto?: Crypto;
};
const providerEndpoint = "https://api.geoapify.com/v1/geocode/autocomplete";
const dispatchBudgetMs = 800; // Conservative margin inside migration 9's ONE-second permit.
const attribution = { text: "Powered by Geoapify | © OpenStreetMap contributors",
    geoapifyUrl: "https://www.geoapify.com/", openStreetMapUrl: "https://www.openstreetmap.org/copyright" };

function configuration(value: SuggestConfig): SuggestConfig | null {
    try {
        const url = new URL(value.supabaseUrl);
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password ||
            url.search || url.hash || url.pathname !== "/" || !text(value.anonKey, 8192) || !text(value.serviceRoleKey, 8192) ||
            !/^[A-Za-z0-9_-]{16,256}$/.test(value.geoapifyKey) || !/^[0-9a-f]{64}$/i.test(value.selectionSecret) ||
            !uuid(value.allowedUserId)) return null;
        return { ...value, supabaseUrl: url.origin, allowedUserId: value.allowedUserId.toLowerCase() };
    } catch { return null; }
}

function selections(data: unknown): VerifiedSelection[] {
    if (!object(data) || !Array.isArray(data.results) || data.results.length > 100) throw new HttpError(502, "provider_unavailable");
    const found: VerifiedSelection[] = [], ids = new Set<string>(), locations = new Set<string>();
    for (const row of data.results) {
        // Geoapify supports no type=building request filter. Check actual granularity,
        // house/street components and building confidence rather than trusting a label.
        if (!object(row) || typeof row.country_code !== "string" || row.country_code.toLowerCase() !== "us" ||
            row.result_type !== "building" || !text(row.housenumber, 100) || !text(row.street, 300) ||
            !text(row.place_id, 300) || !text(row.formatted, 300) || !object(row.rank) ||
            typeof row.rank.confidence !== "number" || row.rank.confidence < 0.8 || row.rank.confidence > 1 ||
            !Number.isFinite(row.rank.confidence) || typeof row.rank.confidence_building_level !== "number" ||
            !Number.isFinite(row.rank.confidence_building_level) || row.rank.confidence_building_level < 0.8 || row.rank.confidence_building_level > 1 ||
            !["full_match", "inner_part", "match_by_building"].includes(String(row.rank.match_type)) ||
            typeof row.lat !== "number" || !Number.isFinite(row.lat) || Math.abs(row.lat) > 90 ||
            typeof row.lon !== "number" || !Number.isFinite(row.lon) || Math.abs(row.lon) > 180 ||
            (row.lat === 0 && row.lon === 0)) continue;
        const location = JSON.stringify([row.formatted, row.lat, row.lon]);
        if (ids.has(row.place_id) || locations.has(location)) continue;
        ids.add(row.place_id); locations.add(location);
        found.push({ id: row.place_id, source: "geoapify", address: row.formatted, latitude: row.lat, longitude: row.lon,
            accuracy: "building", countryCode: "us" });
        if (found.length === 5) break;
    }
    return found;
}

function json(status: number, body: unknown, retryAfter?: number): Response {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Authorization, Origin" };
    if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
    if (status === 405) headers.Allow = "POST";
    return new Response(JSON.stringify(body), { status, headers });
}

export function createSuggestHandler(settings: SuggestConfig, dependencies: Dependencies = {}) {
    const config = configuration(settings);
    const fetcher = dependencies.fetch ?? fetch;
    const now = dependencies.now ?? Date.now;
    const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    let codec: ReturnType<typeof createReceiptCodec> | undefined;

    return async (request: Request): Promise<Response> => {
        try {
            // Native-only first phase. Browser origins/CORS are deliberately not enabled.
            if (request.headers.has("Origin")) throw new HttpError(403, "origin_not_allowed");
            if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
            if (!config) throw new HttpError(503, "service_unavailable");
            const bearer = request.headers.get("Authorization") ?? "";
            if (bearer.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(bearer)) throw new HttpError(401, "unauthorized");
            let input: unknown;
            try { input = await deadline(request.signal, 1000, signal => readJson(request, 2048, signal), new HttpError(400, "invalid_request")); }
            catch { throw new HttpError(400, "invalid_request"); }
            if (!object(input) || Object.keys(input).sort().join(",") !== "action,query" || input.action !== "suggest" ||
                typeof input.query !== "string") throw new HttpError(400, "invalid_request");
            const query = input.query.trim();
            if (!text(query, 300) || [...query].length < 3) throw new HttpError(400, "invalid_request");

            // Auth's /user verifies the JWT server-side, equivalent to getUser(jwt).
            // No decoded caller claim, body actor, API key or service identity substitutes for this user.
            let user: unknown;
            try {
                user = await deadline(request.signal, 3000, async signal => {
                    const response = await fetcher(`${config.supabaseUrl}/auth/v1/user`, { method: "GET",
                        headers: { apikey: config.anonKey, Authorization: bearer }, redirect: "error", signal });
                    if (response.status === 401 || response.status === 403) throw new HttpError(401, "unauthorized");
                    if (!response.ok) throw new HttpError(503, "auth_unavailable");
                    return readJson(response, 65536, signal);
                }, new HttpError(503, "auth_unavailable"));
            } catch (error) { throw error instanceof HttpError ? error : new HttpError(503, "auth_unavailable"); }
            if (!object(user) || !uuid(user.id) || user.role !== "authenticated" || user.is_anonymous === true ||
                (user.is_anonymous !== undefined && typeof user.is_anonymous !== "boolean")) throw new HttpError(401, "unauthorized");
            const userId = user.id.toLowerCase();
            // Compare only the Auth-verified UUID, never a caller claim/name/email.
            // Denied users cannot sign, reserve quota, confirm or contact Geoapify.
            if (userId !== config.allowedUserId) throw new HttpError(403, "access_denied");
            const signer = await (codec ??= createReceiptCodec(config.selectionSecret, config.supabaseUrl, dependencies.crypto));
            const url = new URL(providerEndpoint);
            url.search = new URLSearchParams({ text: query, filter: "countrycode:us", lang: "en", limit: "5", format: "json" }).toString();

            // Start the monotonic budget BEFORE calling the RPC. Admission occurs
            // after this instant, so dispatch within 800ms also precedes the DB's
            // one-second expiry without assuming synchronized Edge/DB wall clocks.
            const reservationStarted = monotonicNow();
            const checkPermit = (expiry: string, signal: AbortSignal) => {
                const elapsed = monotonicNow() - reservationStarted;
                if (signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= dispatchBudgetMs ||
                    Date.parse(expiry) <= now()) throw new HttpError(503, "permit_expired");
            };
            let permit: Record<string, unknown>;
            try {
                // ONE deadline covers reservation, complete bodies and the separate
                // committed-row readback. No fresh budget, retries or permit reuse.
                permit = await deadline(request.signal, dispatchBudgetMs, async signal => {
                    const headers = { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`,
                        "Content-Type": "application/json" };
                    const response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/reserve_geoapify_request`, {
                        method: "POST", headers: { ...headers, Prefer: "tx=commit" },
                        body: JSON.stringify({ acting_user_id: userId }), redirect: "error", signal });
                    const applied = response.headers.get("Preference-Applied") ?? "";
                    // Default hosted commits need not acknowledge tx=commit. Neither
                    // HTTP success nor an acknowledgement replaces the readback below.
                    if (!response.ok || /(?:^|,)\s*tx\s*=\s*rollback\s*(?:,|$)/i.test(applied)) {
                        throw new HttpError(503, "quota_unavailable");
                    }
                    const admission = await readJson(response, 4096, signal);
                    if (!Array.isArray(admission) || admission.length !== 1 || !object(admission[0])) throw new HttpError(503, "quota_unavailable");
                    const row = admission[0];
                    if (row.admitted === false && row.admission_id === null && row.permit_expires_at === null &&
                        ["global_daily_limit", "user_daily_limit", "global_rate_limit"].includes(String(row.reason)) &&
                        Number.isSafeInteger(row.retry_after_seconds) && Number(row.retry_after_seconds) >= 1 && Number(row.retry_after_seconds) <= 86401) {
                        throw new HttpError(429, "quota_exceeded", Number(row.retry_after_seconds));
                    }
                    if (row.admitted !== true || row.reason !== "admitted" || row.retry_after_seconds !== 0 || !uuid(row.admission_id) ||
                        typeof row.permit_expires_at !== "string" || !Number.isFinite(Date.parse(row.permit_expires_at))) throw new HttpError(503, "quota_unavailable");
                    checkPermit(row.permit_expires_at, signal);
                    // A second PostgREST request has its own read-only transaction.
                    // Pass the original timestamp string to preserve PostgreSQL precision.
                    const confirmation = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/confirm_geoapify_request`, {
                        method: "POST", headers, body: JSON.stringify({ target_admission_id: row.admission_id,
                            acting_user_id: userId, expected_permit_expires_at: row.permit_expires_at }), redirect: "error", signal });
                    if (!confirmation.ok || /(?:^|,)\s*tx\s*=\s*rollback\s*(?:,|$)/i.test(confirmation.headers.get("Preference-Applied") ?? "") ||
                        await readJson(confirmation, 4096, signal) !== true) throw new HttpError(503, "quota_unavailable");
                    return row;
                }, new HttpError(503, "quota_unavailable"));
            } catch (error) { throw error instanceof HttpError ? error : new HttpError(503, "quota_unavailable"); }

            const providerData = await deadline(request.signal, 5000, async signal => {
                // Last synchronous guard immediately before the ONLY provider attempt.
                // Also abandon wall-clock-expired permits; skew can only deny dispatch.
                checkPermit(permit.permit_expires_at as string, signal);
                const response = await fetcher(url, { method: "GET", headers: { "x-api-key": config.geoapifyKey }, redirect: "error", signal });
                if (response.status === 429) throw new HttpError(503, "provider_throttled", 60);
                if (!response.ok) throw new HttpError(502, "provider_unavailable");
                return readJson(response, 65536, signal);
            }, new HttpError(504, "provider_timeout"));
            const verified = selections(providerData);
            const suggestions = await Promise.all(verified.map(async selection => ({ ...selection,
                ...await signer.sign(userId, selection, now()) })));
            if (request.signal.aborted) throw new HttpError(503, "request_cancelled");
            return json(200, { suggestions, attribution });
        } catch (error) {
            const failure = error instanceof HttpError ? error : new HttpError(502, "service_unavailable");
            // Never reflect provider URLs, addresses, JWTs, keys, raw bodies or exception messages.
            return json(failure.status, { error: { code: failure.code }, manualEntryAllowed: true }, failure.retryAfter);
        }
    };
}
