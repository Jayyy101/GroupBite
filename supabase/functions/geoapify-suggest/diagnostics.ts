// Temporary, server-opt-in diagnostics. Never accept request/response data or errors.
type Phase = "authorized" | "admission" | "confirmation_complete" | "provider_headers_wait" |
    "provider_headers_received" | "provider_body_read" | "provider_body_complete" |
    "response_processing" | "response_ready";
type Outcome = "deadline" | "parent_cancelled" | "handled_error" | "unexpected_error";

export function createDiagnostics(enabled: boolean, monotonicNow: () => number) {
    let phase: Phase = "authorized", closed = false;
    let invocation: string | undefined, started = 0;
    if (enabled) {
        try { invocation = crypto.randomUUID(); started = monotonicNow(); }
        catch { /* Diagnostics must not change request behavior. */ }
    }
    const emit = (event: "phase" | "failure", outcome?: Outcome) => {
        if (!invocation || closed) return;
        try {
            const elapsed = monotonicNow() - started;
            console.info(JSON.stringify({ diagnostic: "geoapify_suggest_v1", invocation, event, phase,
                elapsed_ms: Number.isFinite(elapsed) ? Math.min(86400000, Math.max(0, Math.floor(elapsed))) : 0,
                ...(outcome === undefined ? {} : { outcome }) }));
        } catch { /* No fallback logging, raw exceptions or awaited log delivery. */ }
    };
    return {
        phase(value: Phase) {
            phase = value; emit("phase");
            if (value === "response_ready") closed = true;
        },
        failure(outcome: Outcome) { emit("failure", outcome); closed = true; },
    };
}
