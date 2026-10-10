import { GEOAPIFY_AUTOCOMPLETE_ENABLED } from "@/lib/address-search";
import type { AddressSearch } from "@/lib/address-search";
import { createGeoapifyAddressSearch, type AddressSearchSession } from "@/lib/geoapify-address-search";
import { supabasePublicConfig } from "@/lib/supabase";
import { useAuth } from "@/providers/auth";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

export type AddressSearchBinding = Readonly<{ mode: "mock" | "geoapify"; search?: AddressSearch }>;

// Mount inside the existing account-keyed form, above disposable focus UI.
// Keeping the adapter stable also keeps Retry-After cooldowns across rerenders.
export function useAddressSearch(): AddressSearchBinding {
    const { session, loading, error } = useAuth();
    const currentSession = useRef<AddressSearchSession | null>(null);
    const ownerId = useRef(session?.user.id);
    const mounted = useRef(true);
    currentSession.current = loading || error ? null : session;
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const enabled = GEOAPIFY_AUTOCOMPLETE_ENABLED && (Platform.OS === "ios" || Platform.OS === "android");
    const [search] = useState<AddressSearch | undefined>(() => enabled ? createGeoapifyAddressSearch({
        supabaseUrl: supabasePublicConfig.url,
        publishableKey: supabasePublicConfig.publishableKey,
        getSession: () => mounted.current && currentSession.current?.user.id === ownerId.current
            ? currentSession.current : null,
    }) : undefined);
    // With the checked-in gate false, the adapter is not even constructed.
    return enabled ? { mode: "geoapify", search } : { mode: "mock" };
}
