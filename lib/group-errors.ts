export function groupErrorMessage(error: unknown): string {
    const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
    // Show only our known RPC messages; never display raw database details or codes.
    switch (message) {
        case "Invalid, revoked, or expired invite code.":
            return "This invite code is invalid or no longer active. Ask the Owner for a new code.";
        case "You are already a member of this group.":
        case "You already have a pending request for this group.":
        case "This request was already decided.":
        case "Transfer ownership before leaving the group.":
            return message;
        case "Membership changed. Refresh and try again.":
            return "Membership changed. Review the refreshed group and confirm your action again.";
        case "Choose another current member.":
            return "Choose another current Member from the refreshed roster.";
        case "Sign in first.":
            return "Please sign in before continuing.";
        case "Only the group Owner may manage invites.":
        case "Only the group Owner may review requests.":
        case "Request not found or access denied.":
            return "This action is only available to the current group Owner.";
        case "Group not found or access denied.":
            return "Your group access or role changed. Refresh the group to continue.";
        default:
            return "Could not complete this action. Check your connection and try again.";
    }
}

export function isGroupAccessDenied(error: unknown): boolean {
    return !!error && typeof error === "object" && "code" in error && error.code === "42501";
}
