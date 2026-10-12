import { supabase } from "@/lib/supabase";

// Capture authorization for the account that owns a form/confirmation. Supabase's
// default header is mutable during account switching; never use it for old drafts.
export async function accountAccessToken(userId: string | undefined): Promise<string> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !userId || data.session?.user.id !== userId || !data.session.access_token) {
        throw new Error("Account changed. Reopen this screen.");
    }
    return data.session.access_token;
}
