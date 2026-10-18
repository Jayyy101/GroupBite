import { withRequestDeadline } from "@/lib/request-deadline";
import { isVisitDate } from "@/lib/restaurant-ui";
import { supabase } from "@/lib/supabase";
import type { PersonalPlace, PersonalPlaceFields, PersonalPlaceSummary } from "@/types/database";

export class PersonalPlaceError extends Error {
    constructor(public readonly kind: "account" | "changed" | "uncertain" | "invalid", message: string) {
        super(message);
    }
}

export function personalPlaceErrorMessage(error: unknown): string {
    return error instanceof PersonalPlaceError ? error.message : "Could not load My Places. Check your connection and refresh.";
}

export function normalizePersonalPlace(fields: PersonalPlaceFields): PersonalPlaceFields {
    // Whitelist content: a structurally compatible PersonalPlace row must not
    // accidentally include immutable metadata in INSERT or UPDATE payloads.
    const value: PersonalPlaceFields = { name: fields.name.trim(), address: fields.address.trim(),
        cuisine: fields.cuisine?.trim() || null, notes: fields.notes?.trim() || null,
        visited_on: fields.visited_on?.trim() || null, rating: fields.rating, would_go_again: fields.would_go_again };
    // Count Unicode characters as PostgreSQL does, rather than UTF-16 code units.
    const length = (text: string) => Array.from(text).length;
    if (!value.name || length(value.name) > 100 || !value.address || length(value.address) > 300) {
        throw new PersonalPlaceError("invalid", "Enter a restaurant name (up to 100 characters) and address (up to 300 characters).");
    }
    if (value.visited_on && !isVisitDate(value.visited_on)) {
        throw new PersonalPlaceError("invalid", "Enter a real visit date as YYYY-MM-DD, or leave it blank.");
    }
    if ((value.cuisine && length(value.cuisine) > 100) || (value.notes && length(value.notes) > 4000)
        || (value.rating !== null && (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5))
        || (value.would_go_again !== null && typeof value.would_go_again !== "boolean")) {
        throw new PersonalPlaceError("invalid", "Check the optional memory fields.");
    }
    return value;
}

async function accountToken(userId: string) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session || data.session.user.id !== userId) {
        throw new PersonalPlaceError("account", "Your account changed. Sign in and reopen My Places.");
    }
    return data.session.access_token;
}

// Pin each request to the initiating account. An account switch must never send
// another user's draft with the new account's default Authorization header.
export async function listPersonalPlaces(userId: string): Promise<PersonalPlaceSummary[]> {
    const token = await accountToken(userId);
    const result = await withRequestDeadline(signal => supabase.from("personal_places").select("*").eq("owner_user_id", userId)
        .order("created_at", { ascending: false }).order("id")
        .setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error) throw result.error;
    if (!result.data.length) return [];
    const totals = new Map(result.data.map(place => [place.id, { sum: 0, rated: 0, visits: 0 }]));
    // Bulk owner-scoped reads, not one request per card. Read only rating facts;
    // keyset paging avoids silently truncating history at the REST row limit.
    let after: string | undefined;
    while (true) {
        const pageToken = await accountToken(userId);
        const query = supabase.from("personal_visits").select("id,personal_place_id,rating").eq("owner_user_id", userId)
            .order("id").limit(500).setHeader("Authorization", `Bearer ${pageToken}`);
        if (after) query.gt("id", after);
        const page = await withRequestDeadline(signal => query.abortSignal(signal).retry(false));
        if (page.error) throw page.error;
        if (!page.data.length) break;
        for (const visit of page.data) {
            const total = totals.get(visit.personal_place_id);
            if (!total) continue;
            total.visits++;
            if (visit.rating !== null) { total.rated++; total.sum += visit.rating; }
        }
        after = page.data[page.data.length - 1].id;
    }
    return result.data.map(place => {
        const total = totals.get(place.id)!;
        return { ...place, average_rating: total.rated ? total.sum / total.rated : null,
            rated_visit_count: total.rated, total_visit_count: total.visits };
    });
}

export async function getPersonalPlace(userId: string, id: string): Promise<PersonalPlace | null> {
    const token = await accountToken(userId);
    const result = await supabase.from("personal_places").select("*").eq("owner_user_id", userId).eq("id", id)
        .setHeader("Authorization", `Bearer ${token}`).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
}

export async function updatePersonalPlace(userId: string, place: PersonalPlace, fields: PersonalPlaceFields, canSend: () => boolean = () => true): Promise<PersonalPlace> {
    const value = normalizePersonalPlace(fields);
    const token = await accountToken(userId);
    if (!canSend()) throw new PersonalPlaceError("invalid", "Save paused before sending. Return to the form and review it before saving.");
    const result = await withRequestDeadline(signal => supabase.rpc("update_personal_place", {
        target_personal_place_id: place.id, expected_revision: place.revision,
        restaurant_name: value.name, restaurant_address: value.address, restaurant_cuisine: value.cuisine,
    }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error) throw new PersonalPlaceError("uncertain", "Could not confirm this update. Cancel and refresh the place before editing again.");
    if (!result.data[0]) throw new PersonalPlaceError("changed", "This place changed or is no longer available. Cancel and refresh before editing again.");
    return result.data[0];
}

export async function deletePersonalPlace(userId: string, place: PersonalPlace): Promise<void> {
    const token = await accountToken(userId);
    const result = await withRequestDeadline(signal => supabase.rpc("delete_personal_place", {
        target_personal_place_id: place.id, expected_revision: place.revision,
    }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error) throw new PersonalPlaceError("uncertain", "Could not confirm deletion. Refresh the place before confirming again.");
    if (!result.data) throw new PersonalPlaceError("changed", "This place changed or is no longer available. Review the refreshed place before deleting.");
}
