import { AddressSearchError } from "./address-search";

// Expo inlines these named PUBLIC values. The UUID is an opt-in UI restriction,
// not authentication; the production handler independently verifies Taylor.
const optedIn = __DEV__ && process.env.EXPO_PUBLIC_GEOAPIFY_DEV_TEST === "true";
const allowedUserId = __DEV__ ? process.env.EXPO_PUBLIC_GEOAPIFY_DEV_USER_ID ?? "" : "";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GEOAPIFY_DEV_TEST_ATTEMPTS = 3;
// Shared across adapters/forms/remounts/accounts in this JS run. Never refund an
// attempt after dispatch: cancellation/failure cannot establish whether it cost.
let attempts = 0;

export function geoapifyDevTestConfigured(): boolean {
    return optedIn && allowedUserId.length === 36 && uuid.test(allowedUserId);
}

export function geoapifyDevTestAllows(userId: string | undefined): boolean {
    return geoapifyDevTestConfigured() && typeof userId === "string" && userId.toLowerCase() === allowedUserId.toLowerCase();
}

export function consumeGeoapifyDevTestAttempt(userId: string, signal: AbortSignal): void {
    if (!geoapifyDevTestAllows(userId)) throw new AddressSearchError("access_denied");
    if (signal.aborted) throw new AddressSearchError("cancelled");
    if (attempts >= GEOAPIFY_DEV_TEST_ATTEMPTS) throw new AddressSearchError("test_limit");
    attempts++;
}
