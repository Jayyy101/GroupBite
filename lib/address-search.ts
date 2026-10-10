// Real autocomplete requires a separately reviewed code change. No environment
// variable, request header or form prop can enable it in this build.
export const GEOAPIFY_AUTOCOMPLETE_ENABLED: boolean = false;

export const GEOAPIFY_ATTRIBUTION = Object.freeze({
    text: "Powered by Geoapify | © OpenStreetMap contributors",
    geoapifyUrl: "https://www.geoapify.com/",
    openStreetMapUrl: "https://www.openstreetmap.org/copyright",
});

type AddressFields = Readonly<{ id: string; address: string; latitude: number; longitude: number }>;
export type MockAddressSuggestion = AddressFields & Readonly<{ source: "development-mock" }>;
export type GeoapifyAddressSuggestion = AddressFields & Readonly<{
    source: "geoapify";
    accuracy: "building";
    countryCode: "us";
    // Opaque server-issued proof. Clients cannot verify or authorize attachment.
    selectionReceipt: string;
    expiresAt: string;
}>;
export type AddressSuggestion = MockAddressSuggestion | GeoapifyAddressSuggestion;
export type AddressSearch = (query: string, signal: AbortSignal) => Promise<readonly AddressSuggestion[]>;
export type AddressSearchErrorKind = "disabled" | "unconfigured" | "invalid_query" | "authentication" |
    "access_denied" | "account_changed" | "rate_limited" | "unavailable" | "invalid_response" | "cancelled" | "timeout";

export class AddressSearchError extends Error {
    constructor(public readonly kind: AddressSearchErrorKind, public readonly retryAfterSeconds?: number) {
        super(kind); // No raw transport errors, credentials, address or body.
        this.name = "AddressSearchError";
    }
}

export function addressSearchErrorMessage(error: unknown): string {
    const fallback = "Address suggestions unavailable. Enter an address manually.";
    if (!(error instanceof AddressSearchError)) return fallback;
    if (error.kind === "authentication" || error.kind === "account_changed") return "Sign in again to use suggestions, or enter an address manually.";
    if (error.kind === "access_denied") return "Address suggestions are not available for this account. Enter an address manually.";
    if (error.kind === "rate_limited") return `Suggestions paused. Wait ${error.retryAfterSeconds ?? 60} seconds before trying again, or enter an address manually.`;
    return fallback;
}
