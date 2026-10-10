// Temporary hosted probe only. Production does not import this module.
import { createSuggestHandler } from "../geoapify-suggest/handler.ts";
import { object, readJson, text, uuid } from "../geoapify-suggest/http.ts";

export type ProbeConfig = {
    supabaseUrl: string;
    anonKey: string;
    serviceRoleKey: string;
    testUserId: string;
};
type Dependencies = {
    fetch?: typeof fetch;
    monotonicNow?: () => number;
    now?: () => number;
    delay?: (ms: number, signal: AbortSignal) => Promise<void>;
};
const modes = ["normal", "confirmation-false", "confirmation-error", "confirmation-stall", "shared-deadline"] as const;
type Mode = typeof modes[number];
const syntheticProviderKey = "groupbite-probe-no-provider-key";
const syntheticSigningValue = "11".repeat(32);
const authPath = "/auth/v1/user";
const reservePath = "/rest/v1/rpc/reserve_geoapify_request";
const confirmPath = "/rest/v1/rpc/confirm_geoapify_request";

function settings(config: ProbeConfig): ProbeConfig {
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || url.port ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash || !uuid(config.testUserId) ||
        !text(config.anonKey, 8192) || !text(config.serviceRoleKey, 8192)) throw new Error("probe_configuration");
    return { ...config, supabaseUrl: url.origin, testUserId: config.testUserId.toLowerCase() };
}
function json(data: unknown, status = 200, originalHeaders?: HeadersInit): Response {
    const headers = new Headers(originalHeaders);
    headers.set("Content-Type", "application/json"); headers.set("Cache-Control", "no-store");
    // The adapter returns bounded, reserialized JSON, not an encoded/teed body.
    headers.delete("Content-Length"); headers.delete("Content-Encoding");
    return new Response(JSON.stringify(data), { status, headers });
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new Error("probe_cancelled")); return; }
        const abort = () => { clearTimeout(timer); reject(new Error("probe_cancelled")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
        signal.addEventListener("abort", abort, { once: true });
    });
}

// One session per invocation: credentials/state cannot transfer between callers.
// The ONLY native Fetch call is below the exact origin/path/method checks.
export function createProbeSession(raw: ProbeConfig, mode: Mode, authorization: string, dependencies: Dependencies = {}) {
    const config = settings(raw);
    if (!modes.includes(mode)) throw new Error("probe_mode");
    const network = dependencies.fetch ?? fetch;
    const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    const now = dependencies.now ?? Date.now;
    const wait = dependencies.delay ?? delay;
    let started: number | undefined;
    let mockDispatchElapsedMs: number | null = null;
    let admission: { id: string; expiry: string } | undefined;
    const state = { authRequests: 0, authVerified: false, reservationRequests: 0, confirmationRequests: 0,
        confirmationVerified: false, mockProviderCalls: 0 };
    const ensureActive = (signal: AbortSignal) => { if (signal.aborted) throw new Error("probe_cancelled"); };
    const holdUntil = async (elapsed: number, signal: AbortSignal) => {
        const remaining = elapsed - (monotonicNow() - started!);
        if (remaining > 0) await wait(remaining, signal);
        ensureActive(signal);
    };
    const restrictedFetch: typeof fetch = async (input, init) => {
        // Request objects could hide method/body/header overrides; the reused
        // handler supplies strings/URLs and explicit init, so reject them here.
        if (!(typeof input === "string" || input instanceof URL) || !init?.signal || init.redirect !== "error") throw new Error("probe_destination");
        const url = new URL(String(input)), signal = init.signal;
        ensureActive(signal);
        if (url.username || url.password || url.hash) throw new Error("probe_destination");
        if (url.origin === "https://api.geoapify.com" && url.pathname === "/v1/geocode/autocomplete") {
            const elapsed = started === undefined ? NaN : monotonicNow() - started;
            const providerHeaders = new Headers(init.headers);
            if ([...url.searchParams.keys()].sort().join(",") !== "filter,format,lang,limit,text" ||
                url.searchParams.get("filter") !== "countrycode:us" || url.searchParams.get("format") !== "json" ||
                url.searchParams.get("lang") !== "en" || url.searchParams.get("limit") !== "5" ||
                providerHeaders.get("x-api-key") !== syntheticProviderKey || [...providerHeaders].length !== 1 ||
                init.method !== "GET" || init.body !== undefined || !state.authVerified ||
                !state.confirmationVerified || !admission || state.mockProviderCalls !== 0 ||
                !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 800 || Date.parse(admission.expiry) <= now()) throw new Error("probe_provider_guard");
            state.mockProviderCalls++;
            mockDispatchElapsedMs = elapsed;
            // No forwarding, no fallback, no provider credentials, no receipts.
            return json({ results: [] });
        }
        if (url.origin !== config.supabaseUrl || url.search || ![authPath, reservePath, confirmPath].includes(url.pathname)) throw new Error("probe_destination");
        const headers = new Headers(init.headers);
        const isAuth = url.pathname === authPath;
        const expectedKey = isAuth ? config.anonKey : config.serviceRoleKey;
        if (init.method !== (isAuth ? "GET" : "POST") || headers.get("apikey") !== expectedKey ||
            headers.get("Authorization") !== (isAuth ? authorization : `Bearer ${config.serviceRoleKey}`)) throw new Error("probe_request");
        if (isAuth) {
            if (state.authRequests !== 0 || init.body !== undefined) throw new Error("probe_request");
            state.authRequests++;
        } else {
            if (!state.authVerified || typeof init.body !== "string" || init.body.length > 2048 || headers.get("Content-Type") !== "application/json") throw new Error("probe_request");
            const body: unknown = JSON.parse(init.body);
            if (!object(body) || body.acting_user_id !== config.testUserId) throw new Error("probe_request");
            if (url.pathname === reservePath) {
                if (state.reservationRequests !== 0 || Object.keys(body).join(",") !== "acting_user_id" || headers.get("Prefer") !== "tx=commit") throw new Error("probe_request");
                started ??= monotonicNow(); state.reservationRequests++;
            } else {
                if (state.confirmationRequests !== 0 || !admission ||
                    Object.keys(body).sort().join(",") !== "acting_user_id,expected_permit_expires_at,target_admission_id" ||
                    body.target_admission_id !== admission.id || body.expected_permit_expires_at !== admission.expiry) throw new Error("probe_request");
                state.confirmationRequests++;
            }
        }
        // Rebuild the request, dropping any unrelated caller-supplied options or
        // headers. Native Fetch cannot follow a redirect out of the allowlist.
        const response = await network(url.href, { method: init.method, signal, redirect: "error", body: init.body,
            headers: isAuth ? { apikey: config.anonKey, Authorization: authorization } : {
                apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json",
                ...(url.pathname === reservePath ? { Prefer: "tx=commit" } : {}),
            } });
        ensureActive(signal);
        if (response.status >= 300 && response.status < 400) throw new Error("probe_redirect");
        if (!response.ok) return response;
        // Bounded observation under the handler's existing deadline; raw bodies,
        // URLs, headers, user records and errors are never logged or returned.
        const data = await readJson(response, isAuth ? 65536 : 4096, signal);
        ensureActive(signal);
        if (isAuth) {
            state.authVerified = object(data) && typeof data.id === "string" && data.id.toLowerCase() === config.testUserId &&
                data.role === "authenticated" && (data.is_anonymous === undefined || data.is_anonymous === false);
            if (!state.authVerified) return json({}, 403);
        } else if (url.pathname === reservePath) {
            if (Array.isArray(data) && data.length === 1 && object(data[0]) && data[0].admitted === true &&
                uuid(data[0].admission_id) && typeof data[0].permit_expires_at === "string") {
                admission = { id: data[0].admission_id, expiry: data[0].permit_expires_at };
            }
            if (mode === "shared-deadline" && admission) await holdUntil(400, signal);
        } else {
            state.confirmationVerified = data === true;
            if (mode === "confirmation-false") return json(false);
            if (mode === "confirmation-error") return json({}, 503);
            if (mode === "confirmation-stall") return new Response(new ReadableStream<Uint8Array>({
                start(controller) { controller.enqueue(new TextEncoder().encode("t")); },
            }), { headers: { "Content-Type": "application/json" } });
            if (mode === "shared-deadline") await holdUntil(850, signal);
        }
        return json(data, response.status, response.headers);
    };
    return { fetch: restrictedFetch, monotonicNow: () => {
        // The reused handler's first monotonic read is its original reservation
        // start. Observe that same value, never substitute or reset its clock.
        const instant = monotonicNow(); started ??= instant; return instant;
    }, report: () => ({ ...state, mode, mockDispatchElapsedMs,
        admissionId: admission?.id ?? null,
        quotaElapsedMs: started === undefined ? null : Math.round((monotonicNow() - started) * 10) / 10,
    }) };
}

export function createProbeHandler(raw: ProbeConfig, dependencies: Dependencies = {}) {
    let config: ProbeConfig | undefined;
    try { config = settings(raw); } catch { /* Invalid/missing setup cannot perform network work. */ }
    return async (request: Request): Promise<Response> => {
        const mode = request.headers.get("X-GroupBite-Probe-Mode") ?? "normal";
        if (!config) return json({ error: { code: "probe_unconfigured" } }, 503);
        if (!modes.some(value => value === mode)) return json({ error: { code: "invalid_probe_mode" } }, 400);
        const session = createProbeSession(config, mode as Mode, request.headers.get("Authorization") ?? "", dependencies);
        const handler = createSuggestHandler({ ...config, geoapifyKey: syntheticProviderKey, selectionSecret: syntheticSigningValue,
            allowedUserId: config.testUserId },
            { fetch: session.fetch, monotonicNow: session.monotonicNow, now: dependencies.now });
        const response = await handler(request);
        const data = await response.json();
        const headers = new Headers(response.headers);
        headers.set("Vary", "Authorization, Origin, X-GroupBite-Probe-Mode");
        return new Response(JSON.stringify({ ...data, probe: session.report() }), { status: response.status, headers });
    };
}
