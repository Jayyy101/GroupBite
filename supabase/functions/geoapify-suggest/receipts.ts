import { object, text, uuid } from "./http.ts";

export type VerifiedSelection = Readonly<{
    id: string;
    source: "geoapify";
    address: string;
    latitude: number;
    longitude: number;
    accuracy: "building";
    countryCode: "us";
}>;
export const RECEIPT_TTL_SECONDS = 600;
const audience = "groupbite.saved-location-selection";

function encode(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Infer the backing-buffer type: Deno 2.1's TypeScript predates generic TypedArrays.
function decode(value: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid receipt");
    const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    if (encode(bytes) !== value) throw new Error("Noncanonical receipt");
    return bytes;
}

export function validSelection(value: unknown): value is VerifiedSelection {
    return object(value) && Object.keys(value).sort().join(",") === "accuracy,address,countryCode,id,latitude,longitude,source" &&
        text(value.id, 300) && text(value.address, 300) && value.source === "geoapify" &&
        value.accuracy === "building" && value.countryCode === "us" &&
        typeof value.latitude === "number" && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
        typeof value.longitude === "number" && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 &&
        !(value.latitude === 0 && value.longitude === 0);
}

// An integrity receipt, not an authentication token or permission to attach.
// No client-controlled fields are ever signed by a public operation.
export async function createReceiptCodec(secret: string, issuer: string, webCrypto: Crypto = crypto) {
    if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error("Invalid signing configuration");
    const bytes = Uint8Array.from(secret.match(/../g)!, pair => parseInt(pair, 16));
    const key = await webCrypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    return {
        async sign(userId: string, selection: VerifiedSelection, nowMs: number) {
            if (!uuid(userId) || !validSelection(selection) || !Number.isFinite(nowMs)) throw new Error("Invalid selection");
            const issuedAt = Math.floor(nowMs / 1000);
            const payload = { v: 1, aud: audience, iss: issuer, sub: userId.toLowerCase(), iat: issuedAt,
                exp: issuedAt + RECEIPT_TTL_SECONDS, selection };
            const body = encode(new TextEncoder().encode(JSON.stringify(payload)));
            const signature = await webCrypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
            return { selectionReceipt: `${body}.${encode(new Uint8Array(signature))}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
        },
        // Reserved for the later server-side attachment phase; no HTTP endpoint yet.
        async verify(receipt: unknown, userId: string, expectedAddress: string, nowMs: number): Promise<VerifiedSelection | null> {
            try {
                if (typeof receipt !== "string" || receipt.length > 4096 || !uuid(userId) || !Number.isFinite(nowMs)) return null;
                const parts = receipt.split(".");
                if (parts.length !== 2) return null;
                const signature = decode(parts[1]);
                if (signature.length !== 32 || !await webCrypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(parts[0]))) return null;
                const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[0])));
                const now = Math.floor(nowMs / 1000);
                if (!object(data) || Object.keys(data).sort().join(",") !== "aud,exp,iat,iss,selection,sub,v" ||
                    data.v !== 1 || data.aud !== audience || data.iss !== issuer || data.sub !== userId.toLowerCase() ||
                    typeof data.iat !== "number" || !Number.isSafeInteger(data.iat) || data.iat > now ||
                    typeof data.exp !== "number" || !Number.isSafeInteger(data.exp) || data.exp - data.iat !== RECEIPT_TTL_SECONDS ||
                    data.exp <= now || !validSelection(data.selection) || data.selection.address !== expectedAddress) return null;
                return data.selection;
            } catch { return null; }
        },
    };
}
