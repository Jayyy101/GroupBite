export function groupErrorMessage(error: unknown): string {
    const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
    // Show only our known RPC messages; never display raw database details or codes.
    switch (message) {
        case "Invalid, revoked, or expired invite code.":
            return "This invite code is invalid or no longer active. Ask the Owner for a new code.";
        case "You are already a member of this group.":
        case "You already have a pending request for this group.":
        case "This request was already decided.":
            return message;
        case "Sign in first.":
            return "Please sign in before continuing.";
        case "Only the group Owner may manage invites.":
        case "Only the group Owner may review requests.":
        case "Request not found or access denied.":
            return "This action is only available to the current group Owner.";
        default:
            return "Could not complete this action. Check your connection and try again.";
    }
}
