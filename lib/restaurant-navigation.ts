import type { AddDestinationResult } from "@/types/database";

export function personalPlaceHref(id: string, fromAdd = false) {
    return { pathname: fromAdd ? "/add/personal-place/[id]" as const : "/personal-place/[id]" as const, params: { id } };
}

export function destinationHref(result: AddDestinationResult, fromAdd = false) {
    return result.destination_kind === "personal" ? personalPlaceHref(result.entry_id!, fromAdd)
        : { pathname: fromAdd ? "/add/group/[id]/restaurant/[entryId]" as const : "/group/[id]/restaurant/[entryId]" as const,
            params: { id: result.group_id!, entryId: result.entry_id! } };
}
