// Native address facts, never inferred from display strings or coordinates.
export type MapKitAddress = Readonly<{
    street: string | null; city: string | null; region: string | null;
    postal_code: string | null; country: string | null; country_code: string | null;
}>;
const limits = { street: 300, city: 200, region: 200, postal_code: 50, country: 200, country_code: 2 } as const;

export function normalizeMapKitAddress(value: unknown): MapKitAddress | undefined {
    if (value === undefined || value === null) return undefined; // Older native builds/records.
    if (typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some(key => !Object.hasOwn(limits, key))) throw new Error("Invalid Apple Maps address details.");
    const input = value as Record<string, unknown>;
    const address = {} as Record<keyof MapKitAddress, string | null>;
    for (const key of Object.keys(limits) as (keyof MapKitAddress)[]) {
        const part = input[key];
        if (part !== undefined && part !== null && (typeof part !== "string"
            || /[\u0000-\u001f\u007f-\u009f]/.test(part) || Array.from(part).length > limits[key])) {
            throw new Error("Invalid Apple Maps address details.");
        }
        address[key] = typeof part === "string" ? part.trim() || null : null;
    }
    if (address.country_code !== null && !/^[A-Z]{2}$/.test(address.country_code)) throw new Error("Invalid Apple Maps country code.");
    return Object.values(address).some(part => part !== null) ? Object.freeze(address) : undefined;
}
