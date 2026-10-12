import { deadline, HttpError, object, readJson, text, uuid } from "../geoapify-suggest/http.ts";
import { createReceiptCodec } from "../geoapify-suggest/receipts.ts";

export type PersonalAttachmentConfig = {
    supabaseUrl: string; anonKey: string; serviceRoleKey: string; selectionSecret: string; allowedUserId: string;
};
type Dependencies = { fetch?: typeof fetch; now?: () => number; crypto?: Crypto };

function configuration(value: PersonalAttachmentConfig): PersonalAttachmentConfig | null {
    try {
        const url = new URL(value.supabaseUrl);
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password ||
            url.search || url.hash || url.pathname !== "/" || !text(value.anonKey, 8192) || !text(value.serviceRoleKey, 8192) ||
            !/^[0-9a-f]{64}$/i.test(value.selectionSecret) || !uuid(value.allowedUserId)) return null;
        return { ...value, supabaseUrl: url.origin, allowedUserId: value.allowedUserId.toLowerCase() };
    } catch { return null; }
}
function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json",
        "Cache-Control": "no-store", Vary: "Authorization, Origin", ...(status === 405 ? { Allow: "POST" } : {}) } });
}
const rolledBack = (response: Response) => /(?:^|,)\s*tx\s*=\s*rollback\s*(?:,|$)/i.test(response.headers.get("Preference-Applied") ?? "");
// A double-precision coordinate can return through SQL/JSON with 15 significant
// digits. This absolute bound covers that formatting at +/-180 degrees; no
// relative tolerance, coercion or rounding of the signed/RPC values is allowed.
const COORDINATE_TOLERANCE = 1e-12;
function coordinatesMatch(actual: unknown, expected: number, bound: number): boolean {
    return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual) <= bound &&
        Number.isFinite(expected) && Math.abs(expected) <= bound && Math.abs(actual - expected) <= COORDINATE_TOLERANCE;
}

export function createPersonalAttachmentHandler(settings: PersonalAttachmentConfig, dependencies: Dependencies = {}) {
    const config = configuration(settings), fetcher = dependencies.fetch ?? fetch, now = dependencies.now ?? Date.now;
    let codec: ReturnType<typeof createReceiptCodec> | undefined;
    return async (request: Request): Promise<Response> => {
        try {
            if (request.headers.has("Origin")) throw new HttpError(403, "origin_not_allowed");
            if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
            if (!config) throw new HttpError(503, "service_unavailable");
            const bearer = request.headers.get("Authorization") ?? "";
            if (bearer.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(bearer)) throw new HttpError(401, "unauthorized");
            let input: unknown;
            try { input = await deadline(request.signal, 1000, signal => readJson(request, 8192, signal), new HttpError(400, "invalid_request")); }
            catch { throw new HttpError(400, "invalid_request"); }
            if (!object(input) || Object.keys(input).sort().join(",") !== "expectedRevision,personalPlaceId,selectionReceipt" ||
                !uuid(input.personalPlaceId) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1 ||
                Number(input.expectedRevision) > 2147483647 || typeof input.selectionReceipt !== "string" ||
                !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input.selectionReceipt) || input.selectionReceipt.length > 4096) throw new HttpError(400, "invalid_request");
            const { personalPlaceId, expectedRevision, selectionReceipt } = input;
            const user = await deadline(request.signal, 3000, async signal => {
                const response = await fetcher(`${config.supabaseUrl}/auth/v1/user`, { method: "GET",
                    headers: { apikey: config.anonKey, Authorization: bearer }, redirect: "error", signal });
                if (response.status === 401 || response.status === 403) throw new HttpError(401, "unauthorized");
                if (!response.ok) throw new HttpError(503, "auth_unavailable");
                return readJson(response, 65536, signal);
            }, new HttpError(503, "auth_unavailable"));
            if (!object(user) || !uuid(user.id) || user.role !== "authenticated" || user.is_anonymous === true ||
                (user.is_anonymous !== undefined && typeof user.is_anonymous !== "boolean")) throw new HttpError(401, "unauthorized");
            const userId = user.id.toLowerCase();
            if (userId !== config.allowedUserId) throw new HttpError(403, "access_denied");

            // One bounded enrichment operation. It never saves/deletes a place,
            // reserves provider quota, makes a provider call or retries a write.
            return await deadline(request.signal, 3000, async signal => {
                const active = () => { if (signal.aborted || request.signal.aborted) throw new HttpError(503, "attachment_unavailable"); };
                const userHeaders = { apikey: config.anonKey, Authorization: bearer };
                const targetUrl = new URL(`${config.supabaseUrl}/rest/v1/personal_places`);
                targetUrl.search = new URLSearchParams({ select: "id,owner_user_id,address,revision", id: `eq.${personalPlaceId.toLowerCase()}`,
                    owner_user_id: `eq.${userId}`, limit: "1" }).toString();
                active();
                const targetResponse = await fetcher(targetUrl, { method: "GET", headers: userHeaders, redirect: "error", signal });
                if (!targetResponse.ok) throw new HttpError(503, "attachment_unavailable");
                const targets = await readJson(targetResponse, 4096, signal);
                if (!Array.isArray(targets) || targets.length > 1) throw new HttpError(503, "attachment_unavailable");
                if (targets.length === 0) throw new HttpError(404, "place_unavailable");
                const target = targets[0];
                if (!object(target) || target.id !== personalPlaceId.toLowerCase() || target.owner_user_id !== userId ||
                    !text(target.address, 300) || !Number.isSafeInteger(target.revision)) throw new HttpError(503, "attachment_unavailable");
                if (target.revision !== expectedRevision) throw new HttpError(409, "place_changed");
                const signer = await (codec ??= createReceiptCodec(config.selectionSecret, config.supabaseUrl, dependencies.crypto));
                const verified = await signer.verifyForAttachment(selectionReceipt, userId, target.address, now());
                if (!verified || Date.parse(verified.expiresAt) <= now()) throw new HttpError(400, "invalid_selection");
                const selection = verified.selection;
                active(); // In particular, late receipt verification cannot start a write.
                const attachment = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/attach_geoapify_personal_place_location`, {
                    method: "POST", redirect: "error", signal,
                    headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`,
                        "Content-Type": "application/json", Prefer: "tx=commit" },
                    body: JSON.stringify({ acting_user_id: userId, target_personal_place_id: target.id, expected_revision: expectedRevision,
                        expected_address: selection.address, verified_latitude: selection.latitude, verified_longitude: selection.longitude,
                        provider_result_id: selection.id, receipt_expires_at: verified.expiresAt }),
                });
                if (rolledBack(attachment)) throw new HttpError(503, "attachment_unconfirmed");
                if (!attachment.ok) {
                    let failure: unknown;
                    try { failure = await readJson(attachment, 4096, signal); } catch { /* Never reflect raw errors. */ }
                    if (object(failure)) {
                        if (failure.code === "40001") throw new HttpError(409, "place_changed");
                        if (failure.code === "42501") throw new HttpError(404, "place_unavailable");
                        if (failure.code === "22023") throw new HttpError(400, "invalid_selection");
                    }
                    throw new HttpError(503, "attachment_unavailable");
                }
                const attached = await readJson(attachment, 1024, signal);
                if (typeof attached !== "boolean") throw new HttpError(503, "attachment_unconfirmed");
                // Hosted default commits need not acknowledge tx=commit. Independently
                // read the committed row using the original user's RLS, not service access.
                const readbackUrl = new URL(`${config.supabaseUrl}/rest/v1/personal_place_locations`);
                readbackUrl.search = new URLSearchParams({ select: "personal_place_id,address_snapshot,resolution_status,latitude,longitude,resolution_provider,provider_location_id,standardized_address,resolution_accuracy",
                    personal_place_id: `eq.${target.id}`, limit: "1" }).toString();
                active();
                const readback = await fetcher(readbackUrl, { method: "GET", headers: userHeaders, redirect: "error", signal });
                if (!readback.ok) throw new HttpError(503, "attachment_unconfirmed");
                const locations = await readJson(readback, 4096, signal);
                if (!Array.isArray(locations) || locations.length !== 1 || !object(locations[0])) throw new HttpError(503, "attachment_unconfirmed");
                const location = locations[0];
                if (location.personal_place_id !== target.id || location.address_snapshot !== target.address || location.resolution_status !== "resolved" ||
                    typeof location.latitude !== "number" || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
                    typeof location.longitude !== "number" || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 ||
                    !text(location.resolution_provider, 100) || !text(location.provider_location_id, 300) || !text(location.standardized_address, 300) ||
                    !["building", "address"].includes(String(location.resolution_accuracy))) throw new HttpError(503, "attachment_unconfirmed");
                if (attached && (location.resolution_provider !== "geoapify" || location.provider_location_id !== selection.id ||
                    !coordinatesMatch(location.latitude, selection.latitude, 90) || !coordinatesMatch(location.longitude, selection.longitude, 180) ||
                    location.standardized_address !== selection.address || location.resolution_accuracy !== "building")) throw new HttpError(503, "attachment_unconfirmed");
                active();
                return json(200, { status: attached ? "attached" : "already_resolved" });
            }, new HttpError(503, "attachment_unavailable"));
        } catch (error) {
            // No diagnostics, payload logging, raw database messages or reflected exceptions.
            const failure = error instanceof HttpError ? error : new HttpError(503, "service_unavailable");
            return json(failure.status, { error: { code: failure.code } });
        }
    };
}
