import { createContext, useContext, useState, type ReactNode } from "react";

const ArchiveContext = createContext<{ allowed: boolean; allow: () => void } | undefined>(undefined);

// Memory only, scoped by the authenticated layout's account key. Existing device
// records have no provable owner: never assign them to the first account to log in.
export function LegacyArchiveProvider({ children }: { children: ReactNode }) {
    const [allowed, setAllowed] = useState(false);
    return <ArchiveContext.Provider value={{ allowed, allow: () => setAllowed(true) }}>{children}</ArchiveContext.Provider>;
}

export function useLegacyArchive() {
    const context = useContext(ArchiveContext);
    if (!context) throw new Error("Legacy archive requires the authenticated app layout.");
    return context;
}
