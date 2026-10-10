// Bounded Fetch/stream operations. No SDK retries, redirect follows, or raw-error logging.
export class HttpError extends Error {
    constructor(public status: number, public code: string, public retryAfter?: number) {
        super(code);
    }
}

export function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown, max: number): value is string {
    return typeof value === "string" && value === value.trim() && [...value].length > 0 &&
        [...value].length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export const uuid = (value: unknown): value is string => typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function deadline<T>(parent: AbortSignal, ms: number,
    operation: (signal: AbortSignal) => Promise<T>, error: HttpError): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (error: HttpError) => void = () => {};
    const abort = () => { controller.abort(); rejectAbort(error); };
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
    parent.addEventListener("abort", abort, { once: true });
    try {
        if (parent.aborted) throw error;
        timer = setTimeout(abort, ms);
        // Race even if the transport ignores abort; late results never enter the handler.
        return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), cancelled]);
    } finally {
        clearTimeout(timer);
        parent.removeEventListener("abort", abort);
        controller.abort();
    }
}

export async function readJson(message: Request | Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
    if (!message.headers.get("Content-Type")?.toLowerCase().split(";")[0].trim().endsWith("/json")) throw new Error("Invalid JSON response");
    const length = message.headers.get("Content-Length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error("Body too large");
    if (!message.body || signal.aborted) throw new Error("Missing body");
    const reader = message.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const part = await reader.read();
            if (signal.aborted) throw new Error("Cancelled");
            if (part.done) break;
            size += part.value.byteLength;
            if (size > maxBytes) throw new Error("Body too large");
            chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
        signal.removeEventListener("abort", cancel);
        cancel();
        reader.releaseLock();
    }
}
