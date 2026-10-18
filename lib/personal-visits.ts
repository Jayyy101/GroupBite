import { accountAccessToken } from "@/lib/account-session";
import { normalizePersonalPlace, PersonalPlaceError } from "@/lib/personal-places";
import { withRequestDeadline } from "@/lib/request-deadline";
import { supabase } from "@/lib/supabase";
import type { PersonalVisit } from "@/types/database";
import type { VisitFieldsValue } from "@/components/visit-fields";

export async function listPersonalVisits(userId: string, placeId: string): Promise<PersonalVisit[]> {
    const token = await accountAccessToken(userId);
    const result = await withRequestDeadline(signal => supabase.from("personal_visits").select("*")
        .eq("owner_user_id",userId).eq("personal_place_id",placeId).order("created_at",{ ascending:false }).order("id")
        .setHeader("Authorization",`Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error) throw new Error("Could not load personal visit history. Refresh to try again.");
    return result.data;
}
export async function managePersonalVisit(userId: string, visit: PersonalVisit, fields: VisitFieldsValue, remove: boolean, canSend: () => boolean) {
    const normalized = normalizePersonalPlace({ name: "visit", address: "visit", cuisine: null, ...fields });
    const token = await accountAccessToken(userId);
    if (!canSend()) return false;
    const result = await withRequestDeadline(signal => supabase.rpc("manage_personal_visit", {
        target_personal_place_id:visit.personal_place_id, target_visit_id:visit.id, expected_revision:visit.revision,
        remove_visit:remove, visit_date:normalized.visited_on, visit_rating:normalized.rating,
        visit_would_go_again:normalized.would_go_again, visit_notes:normalized.notes,
    }).setHeader("Authorization",`Bearer ${token}`).abortSignal(signal).retry(false));
    if (result.error) throw new PersonalPlaceError("uncertain","Could not confirm this change. Check Saved Visit before making another change.");
    if (!result.data.length) throw new PersonalPlaceError("changed","This visit changed or is unavailable. Return to the place and refresh.");
    return true;
}
