import { supabase } from "@/lib/supabase";
import type { Group } from "@/types/database";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

type GroupAccess = { group: Group; membershipId: string };

// Poll only access/ownership metadata. Unchanged results retain their identity so
// in-progress confirmations and Visit forms are not reset by periodic checks.
export function useGroupAccess(groupId: string, userId: string, refreshVersion: number) {
    const isFocused = useIsFocused();
    const [access, setAccess] = useState<GroupAccess | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        setAccess(null);
        setError("");
        setLoading(true);
        if (!isFocused) return;
        let active = true;
        let generation = 0;
        let pending = false;
        async function checkAccess(force = false) {
            if (!active || AppState.currentState !== "active" || (pending && !force)) return;
            const request = ++generation;
            pending = true;
            try {
                const [group, membership] = await Promise.all([
                    supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
                    supabase.from("group_memberships").select("membership_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle(),
                ]);
                if (group.error) throw group.error;
                if (membership.error) throw membership.error;
                if (!active || request !== generation) return;
                setError("");
                if (!group.data || !membership.data) {
                    setAccess(null);
                } else {
                    const next = { group: group.data, membershipId: membership.data.membership_id };
                    setAccess(previous => previous?.membershipId === next.membershipId
                        && previous.group.owner_user_id === next.group.owner_user_id
                        && previous.group.name === next.group.name ? previous : next);
                }
            } catch {
                if (active && request === generation) {
                    setAccess(null);
                    setError("Could not verify group access. Check your connection and refresh.");
                }
            } finally {
                if (active && request === generation) {
                    pending = false;
                    setLoading(false);
                }
            }
        }
        checkAccess();
        const timer = setInterval(() => { checkAccess(); }, 15000);
        const subscription = AppState.addEventListener("change", state => {
            if (state === "active") {
                checkAccess(true);
            } else {
                generation++;
                pending = false;
                setAccess(null);
                setLoading(true);
            }
        });
        return () => {
            active = false;
            generation++;
            clearInterval(timer);
            subscription.remove();
        };
    }, [groupId, userId, isFocused, refreshVersion]);

    return { access, loading, error };
}
