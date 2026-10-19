// Only local, known app routes may be resumed after password sign-in.
// Provider callbacks and external URLs are never navigation destinations here.
export function safeAuthReturnTo(value: unknown): string {
    if (typeof value !== "string" || value.length > 2048 || /[\\\s#]/.test(value)) return "/";
    const path = value.split("?")[0];
    if (path.split("/").some(segment => segment === "." || segment === "..")) return "/";
    if (["/", "/my-places", "/groups", "/add", "/account", "/add-visit", "/personal-place-form", "/personal-visit-form",
        "/create-group", "/join-group", "/saved-places", "/add-place", "/dev-map", "/dev-apple-search"].includes(path)
        || /^\/(?:personal-place|place)\/[^/?%]+$/.test(path)
        || /^\/group\/[^/?%]+(?:\/restaurant\/[^/?%]+)?$/.test(path)
        || /^\/add\/(?:personal-place\/[^/?%]+|group\/[^/?%]+\/restaurant\/[^/?%]+)$/.test(path)) return value;
    return "/";
}

export function authReturnTo(pathname: string, params: Record<string, string | string[]>): string {
    // Path params are already represented in pathname; retain only query params.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if ((key === "id" && /^\/(?:add\/)?(?:personal-place|place|group)\//.test(pathname))
            || (key === "entryId" && /^\/(?:add\/)?group\/[^/]+\/restaurant\//.test(pathname))) continue;
        for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    const search = query.toString();
    return safeAuthReturnTo(pathname + (search ? `?${search}` : ""));
}
