import { createPersonalAttachmentHandler } from "./handler.ts";

const runtime = (globalThis as unknown as { Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Promise<Response>): unknown;
} }).Deno;

// No provider key, provider request, diagnostic flag or client-controlled mode.
runtime.serve(createPersonalAttachmentHandler({
    supabaseUrl: runtime.env.get("SUPABASE_URL") ?? "",
    anonKey: runtime.env.get("SUPABASE_ANON_KEY") ?? "",
    serviceRoleKey: runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    selectionSecret: runtime.env.get("GEOAPIFY_SELECTION_SECRET") ?? "",
    allowedUserId: runtime.env.get("GEOAPIFY_ALLOWED_USER_ID") ?? "",
}));
