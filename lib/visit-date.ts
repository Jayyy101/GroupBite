import { isVisitDate } from "@/lib/restaurant-ui";

// Visits store calendar dates, never instants. Keep the native picker in the
// device's local timezone and use noon to avoid midnight/DST transitions.
export function localToday(now = new Date()): string {
    return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function visitDateToLocal(value: string | null): Date | null {
    if (!value || !isVisitDate(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setHours(12, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    return date;
}

export function visitDateLabel(value: string): string {
    return visitDateToLocal(value)?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) ?? value;
}
