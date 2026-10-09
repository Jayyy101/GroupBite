import { isVisitDate } from "@/lib/restaurant-ui";
import { supabase } from "@/lib/supabase";
import type { PersonalPlace, PersonalPlaceFields } from "@/types/database";

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
export async function listPersonalPlaces(userId: string): Promise<PersonalPlace[]> {
    const token = await accountToken(userId);
    const result = await supabase.from("personal_places").select("*").eq("owner_user_id", userId)
        .order("created_at", { ascending: false }).order("id")
        .setHeader("Authorization", `Bearer ${token}`);
    if (result.error) throw result.error;
    return result.data;
}

export async function getPersonalPlace(userId: string, id: string): Promise<PersonalPlace | null> {
    const token = await accountToken(userId);
    const result = await supabase.from("personal_places").select("*").eq("owner_user_id", userId).eq("id", id)
        .setHeader("Authorization", `Bearer ${token}`).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
}

export async function reconcilePersonalPlace(userId: string, requestId: string): Promise<PersonalPlace | null> {
    const token = await accountToken(userId);
    const result = await supabase.from("personal_places").select("*").eq("owner_user_id", userId)
        .eq("client_request_id", requestId).setHeader("Authorization", `Bearer ${token}`).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
}

export async function createPersonalPlace(userId: string, fields: PersonalPlaceFields, requestId: string): Promise<PersonalPlace> {
    const value = normalizePersonalPlace(fields);
    const token = await accountToken(userId);
    // No upsert or automatic mutation retries. A lost response is reconciled by
    // reading this request ID; a missing result is never automatically recreated.
    const result = await supabase.from("personal_places").insert({ ...value, client_request_id: requestId })
        .select("*").setHeader("Authorization", `Bearer ${token}`).retry(false).single();
    if (!result.error && result.data) return result.data;
    if (result.error && ["22007", "22008", "23514", "42501"].includes(result.error.code)) {
        throw new PersonalPlaceError("invalid", "Could not save this place. Check your session and memory fields.");
    }
    try {
        const saved = await reconcilePersonalPlace(userId, requestId);
        // A duplicate request can already have been edited. Return that record;
        // never overwrite its current contents with the original submission.
        if (saved) return saved;
    } catch (error) {
        if (error instanceof PersonalPlaceError && error.kind === "account") throw error;
    }
    throw new PersonalPlaceError("uncertain", "Could not confirm this save. Check Saved Result or review My Places before starting a new save.");
}

export async function updatePersonalPlace(userId: string, place: PersonalPlace, fields: PersonalPlaceFields): Promise<PersonalPlace> {
    const value = normalizePersonalPlace(fields);
    const token = await accountToken(userId);
    const result = await supabase.from("personal_places").update(value).eq("owner_user_id", userId)
        .eq("id", place.id).eq("revision", place.revision).select("*")
        .setHeader("Authorization", `Bearer ${token}`).retry(false).maybeSingle();
    if (result.error) throw new PersonalPlaceError("uncertain", "Could not confirm this update. Cancel and refresh the place before editing again.");
    if (!result.data) throw new PersonalPlaceError("changed", "This place changed or is no longer available. Cancel and refresh before editing again.");
    return result.data;
}

export async function deletePersonalPlace(userId: string, place: PersonalPlace): Promise<void> {
    const token = await accountToken(userId);
    const result = await supabase.from("personal_places").delete().eq("owner_user_id", userId)
        .eq("id", place.id).eq("revision", place.revision).select("id")
        .setHeader("Authorization", `Bearer ${token}`).retry(false).maybeSingle();
    if (result.error) throw new PersonalPlaceError("uncertain", "Could not confirm deletion. Refresh the place before confirming again.");
    if (!result.data) throw new PersonalPlaceError("changed", "This place changed or is no longer available. Review the refreshed place before deleting.");
}
