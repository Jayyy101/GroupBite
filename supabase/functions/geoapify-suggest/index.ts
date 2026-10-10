import { createSuggestHandler } from "./handler.ts";

// Module-local runtime shape lets existing Expo TypeScript tooling check this
// entry point without installing Deno types or exposing a Deno global to the app.
const runtime = (globalThis as unknown as { Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Promise<Response>): unknown;
} }).Deno;

runtime.serve(createSuggestHandler({
    supabaseUrl: runtime.env.get("SUPABASE_URL") ?? "",
    anonKey: runtime.env.get("SUPABASE_ANON_KEY") ?? "",
    serviceRoleKey: runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    geoapifyKey: runtime.env.get("GEOAPIFY_API_KEY") ?? "",
    selectionSecret: runtime.env.get("GEOAPIFY_SELECTION_SECRET") ?? "",
    allowedUserId: runtime.env.get("GEOAPIFY_ALLOWED_USER_ID") ?? "",
}));
