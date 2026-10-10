// Development fixtures only. These are fictional addresses and sample points,
// not geocoded/verified locations. Never persist or attach their coordinates.
import type { MockAddressSuggestion } from "./address-search";
export type { MockAddressSuggestion } from "./address-search";

export type MockAddressSearch = (query: string, signal: AbortSignal) => Promise<readonly MockAddressSuggestion[]>;

const fixtures: readonly MockAddressSuggestion[] = [
    { id: "demo-100", source: "development-mock", address: "100 Demo Market Street, San Francisco, CA 94103, USA", latitude: 37.7749, longitude: -122.4194 },
    { id: "demo-200", source: "development-mock", address: "200 Demo Market Street, San Francisco, CA 94103, USA", latitude: 37.7759, longitude: -122.4184 },
    { id: "demo-300", source: "development-mock", address: "300 Demo Market Street, San Francisco, CA 94103, USA", latitude: 37.7769, longitude: -122.4174 },
    { id: "demo-400", source: "development-mock", address: "400 Demo Market Street, San Francisco, CA 94103, USA", latitude: 37.7779, longitude: -122.4164 },
    { id: "demo-500", source: "development-mock", address: "500 Demo Market Street, San Francisco, CA 94103, USA", latitude: 37.7789, longitude: -122.4154 },
    { id: "demo-600", source: "development-mock", address: "600 Demo Market Street, San Francisco, CA 94103, USA", latitude: 37.7799, longitude: -122.4144 },
];

export const searchMockAddresses: MockAddressSearch = async (query, signal) => {
    if (!__DEV__ || signal.aborted || query.trim().length < 3) return [];
    const normalized = query.trim().toLowerCase();
    return fixtures.filter(item => item.address.toLowerCase().includes(normalized)).slice(0, 5);
};
