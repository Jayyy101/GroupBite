export const REQUEST_DEADLINE_MS = 20000;

// A deadline bounds the UI wait, not the server transaction. Callers must treat
// a dispatched write as uncertain and must never replay it after this rejects.
export async function withRequestDeadline<T>(request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Could not confirm the response in time.")); }, REQUEST_DEADLINE_MS);
    });
    try { return await Promise.race([request(controller.signal), deadline]); }
    finally { clearTimeout(timer); }
}
