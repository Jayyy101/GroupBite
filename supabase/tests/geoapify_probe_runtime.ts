// Native Deno HTTP/body tests. --allow-net=127.0.0.1 blocks all external traffic.
// No environment access or remote imports. Auth/quota responses are synthetic.
import { createProbeHandler } from "../functions/geoapify-suggest-probe/probe.ts";

declare const Deno: {
    test(name: string, run: () => Promise<void>): void;
    serve(options: { hostname: string; port: number; onListen(): void },
        handler: (request: Request) => Response | Promise<Response>): {
            addr: { port: number }; shutdown(): Promise<void>;
        };
};
const project = "https://abcdefghijklmnopqrst.supabase.co";
const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";
const bearer = "Bearer aaa.e30.signature";
const reservePath = "/rest/v1/rpc/reserve_geoapify_request";
const confirmPath = "/rest/v1/rpc/confirm_geoapify_request";
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function fixture(stall?: "auth" | "reserve" | "confirm", confirmation = true) {
    const admissions = new Map<string, { user: string; expiry: string }>();
    const nativePaths: string[] = [];
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        const phase = path === "/auth/v1/user" ? "auth" : path === reservePath ? "reserve" : "confirm";
        if (phase === stall) return new Response(new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
        }), { headers: { "Content-Type": "application/json" } });
        if (phase === "auth") {
            assert(request.headers.get("apikey") === "synthetic-anon-key");
            if (request.headers.get("Authorization") === "Bearer bbb.e30.signature") return json({ id: userB, role: "authenticated" });
            return request.headers.get("Authorization") === bearer ? json({ id: userA, role: "authenticated", is_anonymous: false }) : json({}, 401);
        }
        assert(request.headers.get("apikey") === "synthetic-service-role-key");
        assert(request.headers.get("Authorization") === "Bearer synthetic-service-role-key");
        const body = await request.json(); assert(body.acting_user_id === userA);
        if (phase === "reserve") {
            const id = crypto.randomUUID(), expiry = new Date(Date.now() + 1000).toISOString();
            admissions.set(id, { user: userA, expiry });
            return json([{ admitted: true, admission_id: id, permit_expires_at: expiry, reason: "admitted", retry_after_seconds: 0 }]);
        }
        assert(path === confirmPath);
        const row = admissions.get(body.target_admission_id);
        return json(confirmation && row !== undefined && row.user === body.acting_user_id &&
            row.expiry === body.expected_permit_expires_at && Date.parse(row.expiry) > Date.now());
    });
    const local = `http://127.0.0.1:${server.addr.port}`;
    const handler = createProbeHandler({ supabaseUrl: project, anonKey: "synthetic-anon-key",
        serviceRoleKey: "synthetic-service-role-key", testUserId: userA }, { fetch: (input, init) => {
        const url = new URL(String(input));
        assert(url.origin === project, "Native Fetch must never receive a provider/external origin");
        assert(["/auth/v1/user", reservePath, confirmPath].includes(url.pathname));
        assert(url.search === "" && init?.redirect === "error"); nativePaths.push(url.pathname);
        // Only this test's synthetic hosted URL maps to loopback. The deployed
        // adapter has no local-host exception or URL rewrite dependency.
        return fetch(local + url.pathname, init);
    } });
    const edge = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
    return { admissions, nativePaths, send: (mode = "normal", authorization = bearer) => fetch(`http://127.0.0.1:${edge.addr.port}/probe`, {
        method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json", "X-GroupBite-Probe-Mode": mode },
        body: JSON.stringify({ action: "suggest", query: "100 Market" }),
    }), async close() { await edge.shutdown(); await server.shutdown(); } };
}

Deno.test("native probe HTTP authenticates the allowlisted account and confirms before local mock dispatch", async () => {
    const f = await fixture();
    try {
        const response = await f.send(); assert(response.status === 200, JSON.stringify(await response.clone().json()));
        const data = await response.json();
        assert(data.suggestions.length === 0 && data.probe.mockProviderCalls === 1 && data.probe.confirmationVerified);
        assert(data.probe.mockDispatchElapsedMs < 800 && f.nativePaths.length === 3 && f.admissions.size === 1);
        assert(f.admissions.get(data.probe.admissionId)?.user === userA);
    } finally { await f.close(); }
});
Deno.test("native probe rejects invalid tokens and another verified account before quota", async () => {
    const f = await fixture();
    try {
        for (const authorization of ["", "Bearer sb_publishable_test", "Bearer forged.e30.signature", "Bearer bbb.e30.signature"]) {
            const response = await f.send("normal", authorization); assert(response.status === 401);
            const data = await response.json(); assert(data.probe.reservationRequests === 0 && data.probe.mockProviderCalls === 0);
        }
        assert(f.admissions.size === 0 && !f.nativePaths.includes(reservePath));
    } finally { await f.close(); }
});
for (const mode of ["confirmation-false", "confirmation-error", "confirmation-stall", "shared-deadline"]) {
    Deno.test(`native probe ${mode} fails closed, retains its admission and performs no provider networking`, async () => {
        const f = await fixture();
        try {
            const response = await f.send(mode); const data = await response.json();
            assert(response.status === 503 && data.error.code === "quota_unavailable");
            assert(data.probe.mockProviderCalls === 0 && data.probe.reservationRequests === 1 && data.probe.confirmationRequests === 1);
            assert(f.admissions.size === 1 && f.nativePaths.length === 3 && data.probe.confirmationVerified === true);
            if (mode === "confirmation-stall" || mode === "shared-deadline") {
                assert(data.probe.quotaElapsedMs >= 700 && data.probe.quotaElapsedMs < 1200, "Shared deadline was extended");
            }
        } finally { await f.close(); }
    });
}
for (const phase of ["auth", "reserve", "confirm"] as const) {
    Deno.test(`native ${phase} body stall cannot escape the handler deadline`, async () => {
        const f = await fixture(phase);
        try {
            const response = await f.send(); const data = await response.json();
            assert(response.status === 503 && data.error.code === (phase === "auth" ? "auth_unavailable" : "quota_unavailable"));
            assert(data.probe.mockProviderCalls === 0);
            if (phase !== "auth") assert(data.probe.quotaElapsedMs >= 700 && data.probe.quotaElapsedMs < 1200);
        } finally { await f.close(); }
    });
}
Deno.test("native false confirmation never becomes a successful mock dispatch", async () => {
    const f = await fixture(undefined, false);
    try {
        const response = await f.send(); const data = await response.json();
        assert(response.status === 503 && data.probe.confirmationVerified === false && data.probe.mockProviderCalls === 0);
        assert(f.admissions.size === 1);
    } finally { await f.close(); }
});
