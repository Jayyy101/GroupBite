import { createProbeHandler } from "./probe.ts";

const runtime = (globalThis as unknown as { Deno: {
    env: { get(name: string): string | undefined };
    serve(handler: (request: Request) => Promise<Response>): unknown;
} }).Deno;

// Only Supabase's server credentials and a NONSECRET disposable-user allowlist
// are read on a future deployment. Real Geoapify/signing secrets are never read.
runtime.serve(createProbeHandler({
    supabaseUrl: runtime.env.get("SUPABASE_URL") ?? "",
    anonKey: runtime.env.get("SUPABASE_ANON_KEY") ?? "",
    serviceRoleKey: runtime.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    testUserId: runtime.env.get("GEOAPIFY_PROBE_USER_ID") ?? "",
}));
