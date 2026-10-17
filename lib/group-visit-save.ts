import { accountAccessToken } from "@/lib/account-session";
import { supabase } from "@/lib/supabase";
import type { SaveVisitArgs } from "@/types/database";

export type GroupVisitSubmission = Readonly<{
    userId: string;
    rpc: "save_restaurant_visit" | "save_restaurant_visit_with_apple_place_id";
    args: Readonly<SaveVisitArgs & { restaurant_apple_place_id?: string }>;
}>;

// Capture before any await. Lifecycle resets may clear the picker, but never this
// submission. Retry uses the same account, RPC, ID, groups, fields and receipt.
export function freezeGroupVisitSubmission(userId: string, fields: Omit<SaveVisitArgs, "client_request_id">,
    applePlaceId?: string | null): GroupVisitSubmission {
    const args: SaveVisitArgs & { restaurant_apple_place_id?: string } = {
        target_group_ids: [...new Set(fields.target_group_ids)].sort(),
        restaurant_name: fields.restaurant_name.trim(), restaurant_address: fields.restaurant_address.trim(),
        restaurant_cuisine: fields.restaurant_cuisine?.trim() || null,
        visit_date: fields.visit_date?.trim() || null, visit_rating: fields.visit_rating ?? null,
        visit_would_go_again: fields.visit_would_go_again ?? null, visit_notes: fields.visit_notes?.trim() || null,
        client_request_id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
    };
    if (__DEV__ && applePlaceId != null) args.restaurant_apple_place_id = applePlaceId;
    Object.freeze(args.target_group_ids);
    return Object.freeze({ userId, rpc: args.restaurant_apple_place_id === undefined
        ? "save_restaurant_visit" : "save_restaurant_visit_with_apple_place_id", args: Object.freeze(args) });
}

export const GROUP_VISIT_SAVE_TIMEOUT_MS = 20000;

// Constructed only at the RPC response boundary for an actual HTTP rejection.
// A local exception with a PostgreSQL-looking code is not proof of rollback.
class VisitSaveServerRejection extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
}

export async function sendGroupVisitSubmission(submission: GroupVisitSubmission, canSend: () => boolean): Promise<string | false> {
    const token = await accountAccessToken(submission.userId);
    if (!canSend()) return false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new Error("Visit save response timed out."));
            }, GROUP_VISIT_SAVE_TIMEOUT_MS);
        });
        // Explicit race also bounds transports that ignore AbortSignal. The
        // transaction may have committed; timeout therefore means uncertain.
        const result = await Promise.race([supabase.rpc(submission.rpc, submission.args)
            .setHeader("Authorization", `Bearer ${token}`).abortSignal(controller.signal).retry(false), deadline]);
        if (result.error) {
            if (result.status >= 400 && result.status <= 599) {
                throw new VisitSaveServerRejection(result.error.code, result.error.message);
            }
            throw result.error;
        }
        const data: unknown = result.data;
        const restaurantId = typeof data === "string" ? data : Array.isArray(data) ? data[0]?.restaurant_id : undefined;
        if (typeof restaurantId !== "string") throw new Error("Could not confirm the saved restaurant identity.");
        return restaurantId;
    } finally { clearTimeout(timer); }
}

// Only explicit database rejection proves that this attempt rolled back. Transport
// failures, aborted responses and timeouts keep the submission locked for retry.
export function isDefinitiveVisitRejection(error: unknown): boolean {
    return error instanceof VisitSaveServerRejection && [
        "22023", "42501", "23514", "23503", "25001", "PGRST202",
        "40P01", "40001", "57014",
    ].includes(error.code);
}
