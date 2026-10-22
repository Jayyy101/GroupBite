import type { AddRestaurant } from "@/types/database";

// Display choices only: database rows and destination-scoped identity rules stay
// unchanged. Different addresses, cuisines or opaque provider IDs stay distinct.
export function recentRestaurantChoices(rows: readonly AddRestaurant[]): AddRestaurant[] {
    const choices = new Map<string, AddRestaurant>();
    for (const row of rows) {
        const { name, address, cuisine } = row;
        const apple_place_id = row.apple_place_id ?? null;
        // Different selected snapshots remain distinct; never discard one while
        // collapsing otherwise identical recent choices from several collections.
        const point = row.mapkit_point;
        const key = JSON.stringify([name, address, cuisine, apple_place_id, point ?? null]);
        // A shared choice carries facts, never an arbitrary destination's entry
        // reference. The existing save RPC resolves each selected destination.
        choices.set(key, choices.has(key) ? { name, address, cuisine, apple_place_id, ...(point ? { mapkit_point: point } : {}) } : row);
    }
    return [...choices.values()];
}
