import { backendStyles as styles } from "@/styles/backend";
import type { GroupMembershipTarget } from "@/types/database";
import { Pressable, Text, View } from "react-native";

export type MembershipAction =
    | { kind: "leave"; groupName: string; membershipId: string }
    | { kind: "remove" | "transfer"; groupName: string; target: GroupMembershipTarget };

export function GroupMembershipConfirmation({ action, busy, onConfirm, onCancel }: {
    action: MembershipAction;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const title = action.kind === "leave" ? `Leave ${action.groupName}?`
        : action.kind === "remove" ? `Remove ${action.target.display_name}?`
            : `Transfer ownership to ${action.target.display_name}?`;
    const description = action.kind === "leave"
        ? "Your visits will stay in this group. You will lose access until you request to join again and are approved."
        : action.kind === "remove"
            ? "They will lose access to this group. Their visits and creator attribution will stay saved. They can request to join again."
            : "You will become a Member and stay in this group. Active invite codes will stop working. Pending requests will remain for the new Owner to review.";
    const label = action.kind === "leave" ? "Confirm Leave Group" : action.kind === "remove" ? "Confirm Remove Member" : "Confirm Transfer Ownership";
    return (
        <View style={styles.card}>
            <Text style={styles.label}>{title}</Text>
            <Text style={styles.message}>{description}</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={[styles.primaryButton, busy && styles.disabled]}>
                <Text style={styles.primaryText}>{busy ? "Updating membership..." : label}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={[styles.secondaryButton, busy && styles.disabled]}>
                <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
        </View>
    );
}
