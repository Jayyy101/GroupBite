// Native Deno/Web Crypto/stream semantics; all Fetch is injected, no permissions.
import { createPersonalAttachmentHandler } from "../functions/geoapify-attach-personal/handler.ts";
import { createReceiptCodec } from "../functions/geoapify-suggest/receipts.ts";

declare const Deno: { test(name: string, run: () => Promise<void>): void };
const user = "11111111-1111-1111-1111-111111111111", other = "22222222-2222-2222-2222-222222222222";
const id = "33333333-3333-3333-3333-333333333333", token = "synthetic.e30.signature";
const config = { supabaseUrl: "https://synthetic.invalid", anonKey: "synthetic-anon-key", serviceRoleKey: "synthetic-service-role-key",
    selectionSecret: "11".repeat(32), allowedUserId: user };
const selection = { id: "synthetic-building", source: "geoapify" as const, address: "100 Public Building, Test City, US",
    latitude: 37.7749, longitude: -122.4194, accuracy: "building" as const, countryCode: "us" as const };
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function fixture(override?: (path: string, signal: AbortSignal) => Response | Promise<Response> | undefined,
    selected = selection) {
    const codec = await createReceiptCodec(config.selectionSecret, config.supabaseUrl);
    const receipt = await codec.sign(user, selected, Date.now());
    let writes = 0;
    const calls: string[] = [];
    const handler = createPersonalAttachmentHandler(config, { fetch: async (input, init) => {
        const url = new URL(String(input)); assert(url.origin === config.supabaseUrl);
        assert(init?.redirect === "error" && init.signal instanceof AbortSignal);
        const headers = new Headers(init.headers);
        const rpc = url.pathname === "/rest/v1/rpc/attach_geoapify_personal_place_location";
        assert(headers.get("apikey") === (rpc ? config.serviceRoleKey : config.anonKey));
        assert(headers.get("Authorization") === `Bearer ${rpc ? config.serviceRoleKey : token}`);
        calls.push(url.pathname);
        const replacement = override?.(url.pathname, init.signal); if (replacement) return replacement;
        if (url.pathname === "/auth/v1/user") return json({ id: user, role: "authenticated", is_anonymous: false });
        if (url.pathname === "/rest/v1/personal_places") return json([{ id, owner_user_id: user, address: selected.address, revision: 1 }]);
        if (rpc) {
            const data = JSON.parse(String(init.body)); assert(data.receipt_expires_at === receipt.expiresAt);
            assert(data.verified_latitude === selected.latitude && data.verified_longitude === selected.longitude && data.expected_address === selected.address);
            writes++; return json(true); // No Preference-Applied; committed readback still required.
        }
        if (url.pathname === "/rest/v1/personal_place_locations") return json([{ personal_place_id: id, address_snapshot: selected.address,
            resolution_status: "resolved", latitude: selected.latitude, longitude: selected.longitude, resolution_provider: "geoapify",
            provider_location_id: selected.id, standardized_address: selected.address, resolution_accuracy: "building" }]);
        throw new Error("Unexpected destination");
    } });
    return { handler, calls, writes: () => writes, request: (signal?: AbortSignal) => new Request(`${config.supabaseUrl}/attach`, {
        method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ personalPlaceId: id, expectedRevision: 1, selectionReceipt: receipt.selectionReceipt }),
    }) };
}

Deno.test("Personal attachment native receipt, exact endpoints and committed readback", async () => {
    const f = await fixture(), response = await f.handler(f.request());
    assert(response.status === 200 && (await response.json()).status === "attached");
    assert(f.calls.length === 4 && f.writes() === 1);
});
Deno.test("Personal attachment native signed doubles tolerate only tiny committed JSON formatting differences", async () => {
    const precise = { ...selection, latitude: 37.555543739424635, longitude: -121.9829590521408 };
    for (const offset of [0, 2e-12]) {
        const f = await fixture(path => path === "/rest/v1/personal_place_locations" ? json([{ personal_place_id: id,
            address_snapshot: precise.address, resolution_status: "resolved", latitude: 37.5555437394246 + offset,
            longitude: -121.982959052141, resolution_provider: "geoapify", provider_location_id: precise.id,
            standardized_address: precise.address, resolution_accuracy: "building" }]) : undefined, precise);
        const result = await f.handler(f.request());
        assert(result.status === (offset === 0 ? 200 : 503));
        const body = await result.json();
        assert(offset === 0 ? body.status === "attached" : body.error.code === "attachment_unconfirmed");
        assert(f.calls.length === 4 && f.writes() === 1);
    }
});
Deno.test("Personal attachment missing JWT and wrong verified user cannot reach a place or mutation", async () => {
    const f = await fixture(path => path === "/auth/v1/user" ? json({ id: other, role: "authenticated" }) : undefined);
    assert((await f.handler(new Request(`${config.supabaseUrl}/attach`, { method: "POST" }))).status === 401);
    assert(f.calls.join(",") === "");
    assert((await f.handler(f.request())).status === 403); assert(f.calls.length === 1 && f.writes() === 0);
});
Deno.test("Personal attachment shared deadline cancels stalled target body before mutation", async () => {
    let cancelled = false, signal: AbortSignal | undefined;
    const f = await fixture((path, current) => {
        if (path !== "/rest/v1/personal_places") return;
        signal = current;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("[")); },
            cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
    });
    const start = performance.now(), response = await f.handler(f.request());
    assert(response.status === 503 && (await response.json()).error.code === "attachment_unavailable");
    assert(performance.now() - start < 3800 && signal?.aborted && cancelled);
    assert(f.calls.length === 2 && f.writes() === 0);
});
Deno.test("Personal attachment cancellation after mutation remains unconfirmed without replay", async () => {
    const parent = new AbortController();
    let cancelled = false;
    const f = await fixture(path => {
        if (path !== "/rest/v1/personal_place_locations") return;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(new TextEncoder().encode("["));
        }, pull() { parent.abort(); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
    });
    const response = await f.handler(f.request(parent.signal));
    assert(response.status === 503 && (await response.json()).error.code === "attachment_unavailable");
    assert(f.calls.length === 4 && f.writes() === 1 && cancelled);
});
