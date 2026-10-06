import type { GroupRestaurantSummary } from "@/types/database";

export function isUuid(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function isVisitDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function visitSummary(restaurant: GroupRestaurantSummary): string {
    const rating = restaurant.average_rating === null ? "No ratings yet" : `Average ${restaurant.average_rating.toFixed(1)}/5`;
    return `${rating} · ${restaurant.rated_visit_count} rated / ${restaurant.total_visit_count} total visits`;
}

export function restaurantErrorMessage(error: unknown): string {
    const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
    switch (message) {
        case "You must be a current member of every selected group.":
            return "You need to be a current member of every selected group. Refresh your groups and try again.";
        case "Enter a restaurant name and address.":
        case "Choose at least one group.":
        case "Check the optional visit fields.":
            return message;
        case "Sign in first.":
            return "Please sign in before saving a visit.";
        default:
            return "Could not save the visit. Check your connection and retry with the same details.";
    }
}

export function visitManagementErrorMessage(error: unknown, action: "edit" | "delete"): string {
    const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
    switch (message) {
        case "Visit not found or access denied.":
            return "This visit is no longer available, or you do not have permission to manage it. Cancel and refresh the restaurant.";
        case "Check the optional visit fields.":
            return message;
        case "Sign in first.":
            return "Please sign in before managing a visit.";
        default:
            return `Could not ${action === "edit" ? "update" : "delete"} the visit. Check your connection, then retry or cancel and refresh to check its status.`;
    }
}
