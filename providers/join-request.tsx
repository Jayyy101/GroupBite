import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Attempt = { status: "pending" | "uncertain" };
type JoinSafety = {
    attempt: Attempt | null;
    revision: number;
    begin: () => Attempt | null;
    owns: (attempt: Attempt) => boolean;
    settle: (attempt: Attempt, uncertain: boolean) => boolean;
    acknowledge: (attempt: Attempt) => boolean;
};
const JoinRequestContext = createContext<JoinSafety | null>(null);

// Account-scoped, memory-only protection across route remounts. Stores neither
// invite codes nor credentials; this is not durable recovery or server idempotency.
export function JoinRequestProvider({ children }: { children: ReactNode }) {
    const pending = useRef<Attempt | null>(null), alive = useRef(true), revision = useRef(0);
    const [attempt, setAttempt] = useState<Attempt | null>(null);
    const generation = revision.current;
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    function owns(owner: Attempt) { return alive.current && pending.current === owner; }
    function update(next: Attempt | null) { revision.current++; pending.current = next; setAttempt(next); }
    function begin() {
        // An old submit callback cannot begin again after settlement/acknowledgement.
        if (!alive.current || revision.current !== generation || pending.current) return null;
        const next: Attempt = { status: "pending" };
        update(next);
        return next;
    }
    function settle(owner: Attempt, uncertain: boolean) {
        if (!owns(owner)) return false;
        update(uncertain ? { status: "uncertain" } : null);
        return true;
    }
    function acknowledge(owner: Attempt) {
        if (!owns(owner) || owner.status !== "uncertain") return false;
        update(null);
        return true;
    }
    return <JoinRequestContext.Provider value={{ attempt, revision: revision.current, begin, owns, settle, acknowledge }}>{children}</JoinRequestContext.Provider>;
}

export function useJoinRequest() {
    const context = useContext(JoinRequestContext);
    if (!context) throw new Error("Join requests require the authenticated app layout.");
    return context;
}
