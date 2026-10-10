// Native Deno/Web API tests. Network permission is restricted to loopback.
// No env access, imports from registries, real Auth or Geoapify traffic.
import { createSuggestHandler } from "../functions/geoapify-suggest/handler.ts";
import { createReceiptCodec } from "../functions/geoapify-suggest/receipts.ts";

// Module-local declarations keep the Expo compiler independent of Deno typings.
declare const Deno: {
    args: string[];
    test(name: string, run: () => Promise<void>): void;
    serve(options: { hostname: string; port: number; signal?: AbortSignal; onListen(): void },
        handler: (request: Request) => Response | Promise<Response>): {
            addr: { port: number }; finished: Promise<void>; shutdown(): Promise<void>;
        };
};

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";
const tokenA = "aaa.e30.signature", tokenB = "bbb.e30.signature";
const selectionSecret = "11".repeat(32); // Existing public synthetic test fixture.
const providerRow = { place_id: "fixture-building", formatted: "100 Market Street, San Francisco, CA, US",
    country_code: "us", result_type: "building", housenumber: "100", street: "Market Street", lat: 37.7749, lon: -122.4194,
    rank: { confidence: 0.95, confidence_building_level: 0.95, match_type: "full_match" } };
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
function json(body: unknown, headers: Record<string, string> = {}, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
async function fixture(stall?: "auth" | "quota" | "confirmation" | "provider") {
    let authCalls = 0, quotaCalls = 0, confirmationCalls = 0, providerCalls = 0;
    let lastSignal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen() {} }, request => {
        const path = new URL(request.url).pathname;
        if (path === "/auth/v1/user") authCalls++;
        if (path === "/rest/v1/rpc/reserve_geoapify_request") quotaCalls++;
        if (path === "/rest/v1/rpc/confirm_geoapify_request") confirmationCalls++;
        if (path === "/mock-provider") providerCalls++;
        if (path === "/mock-provider") {
            assert(request.headers.get("x-api-key") === "synthetic-geoapify-key");
            assert(!request.headers.has("Authorization") && !request.headers.has("apikey"));
        } else assert(!request.headers.has("x-api-key"));
        const phase = path === "/auth/v1/user" ? "auth" : path.endsWith("/reserve_geoapify_request") ? "quota" : path.endsWith("/confirm_geoapify_request") ? "confirmation" : "provider";
        if (phase === stall) return new Response(new ReadableStream({ start(stream) {
            stream.enqueue(new TextEncoder().encode("{")); // Headers plus partial JSON, then stall.
        } }), { headers: { "Content-Type": "application/json", "Preference-Applied": "tx=commit" } });
        if (phase === "auth") {
            const bearer = request.headers.get("Authorization");
            return bearer === `Bearer ${tokenA}` || bearer === `Bearer ${tokenB}`
                ? json({ id: bearer === `Bearer ${tokenA}` ? userA : userB, role: "authenticated", is_anonymous: false })
                : json({}, {}, 401);
        }
        if (phase === "quota") return json([{ admitted: true, admission_id: "33333333-3333-3333-3333-333333333333",
            permit_expires_at: new Date(Date.now() + 1000).toISOString(), reason: "admitted", retry_after_seconds: 0 }],
            { "Preference-Applied": "tx=commit" });
        if (phase === "confirmation") return json(true);
        return json({ results: [providerRow] });
    });
    const origin = `http://127.0.0.1:${server.addr.port}`;
    const handler = createSuggestHandler({ supabaseUrl: origin, anonKey: "synthetic-anon-key", serviceRoleKey: "synthetic-service-role-key",
        geoapifyKey: "synthetic-geoapify-key", selectionSecret, allowedUserId: userA }, { fetch: (input, init) => {
        const url = new URL(String(input));
        assert(url.origin === origin || url.origin === "https://api.geoapify.com", "Unexpected destination");
        assert(init?.redirect === "error");
        if (url.origin === "https://api.geoapify.com") {
            assert(!url.href.includes("synthetic-geoapify-key") && !url.searchParams.has("apiKey"));
            assert([...url.searchParams.keys()].sort().join(",") === "filter,format,lang,limit,text");
            const headers = new Headers(init?.headers);
            assert([...headers].length === 1 && headers.get("x-api-key") === "synthetic-geoapify-key");
        }
        lastSignal = init?.signal;
        // The provider URL is NEVER fetched; replace it with the local fixture.
        return fetch(url.origin === origin ? url : `${origin}/mock-provider`, init);
    } });
    const edge = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
    return { origin, send: (token = tokenA) => fetch(`http://127.0.0.1:${edge.addr.port}/suggest`, { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "suggest", query: "100 Market" }) }),
        counts: () => ({ authCalls, quotaCalls, confirmationCalls, providerCalls, aborted: lastSignal?.aborted === true }),
        async close() { await edge.shutdown(); controller.abort(); await server.finished; } };
}

Deno.test("Deno.serve, Fetch, Web Crypto and same-account receipt verification", async () => {
    const f = await fixture();
    try {
        const response = await f.send(); assert(response.status === 200);
        const data = await response.json(); assert(data.suggestions.length === 1);
        const receipt = data.suggestions[0].selectionReceipt;
        const codec = await createReceiptCodec(selectionSecret, f.origin);
        assert(await codec.verify(receipt, userA, providerRow.formatted, Date.now()));
        assert(await codec.verify(receipt, userB, providerRow.formatted, Date.now()) === null);
        assert(await codec.verify(receipt + ".extra", userA, providerRow.formatted, Date.now()) === null);
        assert(await codec.verify(receipt, userA, "Edited address", Date.now()) === null);
        const counts = f.counts(); assert(counts.authCalls === 1 && counts.quotaCalls === 1 && counts.confirmationCalls === 1 && counts.providerCalls === 1);
    } finally { await f.close(); }
});

Deno.test("Deno concurrent allowlisted, wrong-user and invalid Auth requests stay isolated before quota", async () => {
    const f = await fixture();
    try {
        const responses = await Promise.all([f.send(tokenA), f.send(tokenB), f.send("forged.e30.signature")]);
        assert(responses[2].status === 401); await responses[2].json();
        assert(responses[1].status === 403);
        const [a, b] = await Promise.all(responses.slice(0, 2).map(response => response.json()));
        assert(b.error.code === "access_denied" && b.manualEntryAllowed === true && !b.suggestions);
        const codec = await createReceiptCodec(selectionSecret, f.origin);
        assert(await codec.verify(a.suggestions[0].selectionReceipt, userA, providerRow.formatted, Date.now()));
        assert(await codec.verify(a.suggestions[0].selectionReceipt, userB, providerRow.formatted, Date.now()) === null);
        const counts = f.counts(); assert(counts.authCalls === 3 && counts.quotaCalls === 1 && counts.confirmationCalls === 1 && counts.providerCalls === 1);
    } finally { await f.close(); }
});

for (const phase of ["auth", "quota", "confirmation", "provider"] as const) Deno.test(`Deno real HTTP ${phase} partial body times out without later dispatch`, async () => {
    const f = await fixture(phase);
    try {
        const start = performance.now(); const response = await f.send();
        const data = await response.json();
        const expected = { auth: [503, "auth_unavailable"], quota: [503, "quota_unavailable"], confirmation: [503, "quota_unavailable"], provider: [504, "provider_timeout"] }[phase];
        assert(response.status === expected[0] && data.error.code === expected[1]);
        assert(data.manualEntryAllowed === true && !data.suggestions);
        const elapsed = performance.now() - start;
        assert(elapsed >= { auth: 2900, quota: 700, confirmation: 700, provider: 4900 }[phase] && elapsed < 10000, "Body deadline not enforced");
        const counts = f.counts(); assert(counts.aborted);
        assert(counts.providerCalls === (phase === "provider" ? 1 : 0));
        assert(counts.quotaCalls === (phase === "auth" ? 0 : 1));
    } finally { await f.close(); }
});

// The optional disposable PostgreSQL/PostgREST runner supplies this loopback URL.
// Its mock provider observes admissions through a separate DB connection.
if (Deno.args.length) {
    const gateway = new URL(Deno.args[0]);
    assert(gateway.protocol === "http:" && gateway.hostname === "127.0.0.1" && gateway.pathname === "/");
    async function control(action: string, mode: string) {
        const response = await fetch(new URL(`control/${action}`, gateway), { method: "POST", headers: { "X-Test-Mode": mode } });
        assert(response.ok); return response.json();
    }
    function databaseHandler(mode: string, allowedUserId = userA) {
        return createSuggestHandler({ supabaseUrl: gateway.origin, anonKey: "synthetic-anon-key", serviceRoleKey: "synthetic-service-role-key",
            geoapifyKey: "synthetic-geoapify-key", selectionSecret, allowedUserId }, { fetch: (input, init) => {
            const url = new URL(String(input));
            assert(url.origin === gateway.origin || url.origin === "https://api.geoapify.com");
            if (url.origin === "https://api.geoapify.com") {
                assert(!url.searchParams.has("apiKey") && !url.href.includes("synthetic-geoapify-key"));
                const providerHeaders = new Headers(init?.headers);
                assert([...providerHeaders].length === 1 && providerHeaders.get("x-api-key") === "synthetic-geoapify-key");
            }
            const headers = new Headers(init?.headers); headers.set("X-Test-Mode", mode);
            return fetch(url.origin === gateway.origin ? url : new URL("mock-provider", gateway), { ...init, headers });
        } });
    }
    function directRequest(token = tokenA) {
        return new Request(new URL("suggest", gateway), { method: "POST", headers: {
            "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        }, body: JSON.stringify({ action: "suggest", query: "100 Market" }) });
    }
    for (const mode of ["commit", "no-ack-commit"]) Deno.test(`real PostgREST ${mode} requires committed readback before mocked provider execution`, async () => {
        await control("reset", mode);
        const response = await databaseHandler(mode)(directRequest());
        assert(response.status === 200, JSON.stringify(await response.clone().json())); await response.json();
        const state = await control("state", mode);
        assert(state.confirmationCalls === 1);
        assert(state.rows === 1 && state.providerCalls === 1 && state.observedCommits === 1);
        assert(state.transactionHeaders.every((header: string) => mode === "commit" ? /tx=commit/.test(header) : header === ""));
    });
    for (const mode of ["silent-rollback", "reported-rollback", "missing-confirmation"]) Deno.test(`real PostgREST ${mode} never reaches mocked provider`, async () => {
        await control("reset", mode);
        const response = await databaseHandler(mode)(directRequest()); const data = await response.json();
        assert(response.status === 503 && data.error.code === "quota_unavailable");
        const state = await control("state", mode);
        assert(state.providerCalls === 0 && state.observedCommits === 0);
        assert(state.rows === (mode === "missing-confirmation" ? 1 : 0));
        assert(state.confirmationCalls === (mode === "reported-rollback" ? 0 : 1));
        assert(state.rpcAdmitted === true, "Exercise a successful admitted RPC response, not an unrelated failure");
    });
    for (const limit of ["user-limit", "global-limit"]) Deno.test(`real Migration 9 ${limit} denies provider`, async () => {
        await control("reset", "no-ack-commit"); await control(limit, "no-ack-commit");
        const response = await databaseHandler("no-ack-commit")(directRequest()); const data = await response.json();
        assert(response.status === 429 && data.error.code === "quota_exceeded");
        const state = await control("state", "commit"); assert(state.providerCalls === 0 && state.rows === (limit === "user-limit" ? 100 : 1000));
    });
    for (const mode of ["quota-body-stall", "confirmation-body-stall", "provider-body-stall", "provider-failure"]) Deno.test(`real committed admission survives ${mode} without retries or refunds`, async () => {
        await control("reset", mode);
        const response = await databaseHandler(mode)(directRequest()); const data = await response.json();
        const expected = { "quota-body-stall": [503, "quota_unavailable"], "confirmation-body-stall": [503, "quota_unavailable"], "provider-body-stall": [504, "provider_timeout"],
            "provider-failure": [502, "provider_unavailable"] }[mode as "quota-body-stall" | "confirmation-body-stall" | "provider-body-stall" | "provider-failure"];
        assert(response.status === expected[0] && data.error.code === expected[1]);
        const state = await control("state", mode); assert(state.rows === 1 && state.rpcAdmitted === true);
        assert(state.providerCalls === (mode === "quota-body-stall" || mode === "confirmation-body-stall" ? 0 : 1));
        assert(state.observedCommits === state.providerCalls);
    });
    Deno.test("real default-commit concurrency permits three confirmed starts and denies the remaining calls", async () => {
        await control("reset", "no-ack-commit");
        const handler = databaseHandler("no-ack-commit");
        const other = databaseHandler("no-ack-commit", userB);
        const responses = await Promise.all(Array.from({ length: 12 }, (_, i) =>
            i % 2 ? other(directRequest(tokenB)) : handler(directRequest(tokenA))));
        assert(responses.filter(response => response.status === 200).length === 3);
        assert(responses.filter(response => response.status === 429).length === 9);
        await Promise.all(responses.map(response => response.json()));
        const state = await control("state", "commit"); assert(state.rows === 3 && state.providerCalls === 3 && state.observedCommits === 3 && state.confirmationCalls === 3);
    });
    Deno.test("real readback shares the original budget after a delayed reservation response", async () => {
        await control("reset", "shared-budget");
        const start = performance.now();
        const response = await databaseHandler("shared-budget")(directRequest());
        const data = await response.json();
        assert(response.status === 503 && data.error.code === "quota_unavailable");
        assert(performance.now() - start < 1200, "Readback must not restart the 800ms deadline");
        // Give the deliberately late confirmation time to finish: it cannot dispatch.
        await new Promise(resolve => setTimeout(resolve, 200));
        const state = await control("state", "shared-budget");
        assert(state.rows === 1 && state.confirmationCalls === 1 && state.providerCalls === 0);
    });
    Deno.test("explicit retry after provider failure needs another distinct committed admission", async () => {
        await control("reset", "provider-failure");
        const handler = databaseHandler("provider-failure");
        for (let i = 0; i < 2; i++) {
            const response = await handler(directRequest());
            assert(response.status === 502); await response.json();
        }
        const state = await control("state", "provider-failure");
        assert(state.rows === 2 && state.confirmationCalls === 2 && state.providerCalls === 2 && state.observedCommits === 2);
    });

}
