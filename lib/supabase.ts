import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock } from "@supabase/supabase-js";
import { Platform } from "react-native";
import type { Database } from "@/types/database";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url?.trim() || !publishableKey?.trim()) {
    throw new Error(
        "Supabase configuration is missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your local .env and restart Expo."
    );
}

if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error("Supabase requires a publishable key (sb_publishable_). Never configure a secret or service-role key in this app.");
}

export const supabase = createClient<Database>(url, publishableKey, {
    auth: {
        ...(Platform.OS !== "web" ? { storage: AsyncStorage, lock: processLock } : {}),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
    },
});
