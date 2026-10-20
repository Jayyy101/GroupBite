// Temporary, opt-in development tracing. Only numeric/boolean metadata is
// accepted: never pass queries, restaurant facts, provider IDs or account data.
export const searchDiagnosticsEnabled = __DEV__ && process.env.EXPO_PUBLIC_GROUPBITE_SEARCH_DIAGNOSTICS === "1";
let sequence = 0, scope = 0;
export function newSearchDiagnosticScope() { return searchDiagnosticsEnabled ? ++scope : 0; }
export function traceSearch(event: string, data: Record<string, number | boolean | null> = {}) {
    if (!searchDiagnosticsEnabled) return;
    console.info(`[GroupBiteSearch] ${JSON.stringify({ sequence: ++sequence, time: Date.now(), event, ...data })}`);
}
