import { createContext, type RefObject } from "react";

export type TabLeaveHandler = (leave: () => void) => void;

// The focused inline form owns this registration. Tab presses can blur a root
// without removing it, so usePreventRemove alone cannot guard these drafts.
export const TabLeaveContext = createContext<RefObject<TabLeaveHandler | null> | null>(null);
