import { useEffect, useState } from "react";
import { AppState } from "react-native";

// Navigation focus does not change when a native app returns from background.
export function useForegroundRefresh() {
    const [version, setVersion] = useState(0);
    const [isActive, setIsActive] = useState(AppState.currentState === "active");
    useEffect(() => {
        let previous = AppState.currentState;
        const subscription = AppState.addEventListener("change", state => {
            setIsActive(state === "active");
            if (state === "active" && previous !== "active") setVersion(value => value + 1);
            previous = state;
        });
        return () => subscription.remove();
    }, []);
    return { version, isActive };
}
