import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Attempt = { name: string; status: "pending" | "uncertain" };
type CreationSafety = {
    attempt: Attempt | null;
    begin: (name: string) => Attempt | null;
    settle: (attempt: Attempt, uncertain: boolean) => void;
    acknowledge: (attempt: Attempt) => void;
};
const GroupCreationContext = createContext<CreationSafety | null>(null);

// Lives above tab/route remounts, inside the authenticated account key. Memory
// only: this cannot provide server idempotency or survive a process restart.
export function GroupCreationProvider({ children }: { children: ReactNode }) {
    const pending = useRef<Attempt | null>(null);
    const alive = useRef(true);
    const [attempt, setAttempt] = useState<Attempt | null>(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    function begin(name: string) {
        if (!alive.current || pending.current) return null;
        const next: Attempt = { name, status: "pending" };
        pending.current = next; setAttempt(next);
        return next;
    }
    function settle(owner: Attempt, uncertain: boolean) {
        if (!alive.current || pending.current !== owner) return;
        const next: Attempt | null = uncertain ? { name: owner.name, status: "uncertain" } : null;
        pending.current = next; setAttempt(next);
    }
    function acknowledge(owner: Attempt) {
        if (!alive.current || pending.current !== owner || owner.status !== "uncertain") return;
        pending.current = null; setAttempt(null);
    }
    return <GroupCreationContext.Provider value={{ attempt, begin, settle, acknowledge }}>{children}</GroupCreationContext.Provider>;
}

export function useGroupCreation() {
    const context = useContext(GroupCreationContext);
    if (!context) throw new Error("Group creation requires the authenticated app layout.");
    return context;
}
