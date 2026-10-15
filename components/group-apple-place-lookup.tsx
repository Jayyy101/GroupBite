import ApplePlaceLookup from "@/components/personal-apple-place-lookup";
import { accountAccessToken } from "@/lib/account-session";
import { AppleSearchError } from "@/lib/apple-map-search";
import { supabase } from "@/lib/supabase";
import { useCallback } from "react";

// Rendered only after authorized group detail loading. The RPC rechecks current
// membership AND both identities, including before displaying late Apple data.
export default function GroupApplePlaceLookup({ userId, groupId, entryId, disabled }: {
    userId: string; groupId: string; entryId: string; disabled: boolean;
}) {
    const readSavedId = useCallback(async (signal: AbortSignal): Promise<string | null> => {
        try {
            const token = await accountAccessToken(userId);
            if (signal.aborted) return null;
            const result = await supabase.rpc("get_group_restaurant_apple_place_id", {
                target_group_id: groupId, target_group_restaurant_id: entryId,
            }).setHeader("Authorization", `Bearer ${token}`).abortSignal(signal).retry(false);
            if (result.error) throw result.error;
            if (signal.aborted) return null;
            const row = result.data?.[0];
            if (result.data?.length !== 1 || row?.group_id !== groupId || row.group_restaurant_id !== entryId) throw new Error("Entry changed");
            return row.apple_place_id;
        } catch {
            throw new AppleSearchError("unavailable", "Could not verify this saved restaurant or your group access. Refresh the restaurant and try again.");
        }
    }, [userId, groupId, entryId]);
    return __DEV__ ? <ApplePlaceLookup disabled={disabled} readSavedId={readSavedId} /> : null;
}
