import { AddCoordinator, type AddState } from "@/lib/unified-add";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const Context = createContext<{ coordinator: AddCoordinator; state: AddState } | null>(null);
export function UnifiedAddProvider({ userId, children }: { userId: string; children: ReactNode }) {
    const [coordinator] = useState(() => new AddCoordinator(userId));
    const [state, setState] = useState(coordinator.state);
    useEffect(() => {
        coordinator.activate();
        const unsubscribe = coordinator.subscribe(setState);
        void coordinator.restore();
        return () => { unsubscribe(); coordinator.dispose(); };
    }, [coordinator]);
    return <Context.Provider value={{ coordinator, state }}>{children}</Context.Provider>;
}
export function useUnifiedAdd() {
    const value = useContext(Context);
    if (!value) throw new Error("Unified Add requires the signed-in account provider.");
    return value;
}
