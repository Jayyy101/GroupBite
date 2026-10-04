export function authErrorMessage(error: unknown): string {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    switch (code) {
        case "invalid_credentials":
            return "That email and password combination was not recognized.";
        case "email_not_confirmed":
            return "Please verify your email before signing in.";
        case "user_already_exists":
        case "email_exists":
            return "An account with this email already exists. Please sign in.";
        case "weak_password":
            return "Please use a stronger password with more characters and a mix of letters, numbers, and symbols.";
        case "email_address_invalid":
        case "validation_failed":
            return "Please check your email address and password.";
        case "over_email_send_rate_limit":
        case "over_request_rate_limit":
            return "Too many attempts. Please wait a few minutes and try again.";
        case "signup_disabled":
            return "New account registration is currently unavailable.";
        default:
            return "Could not complete the request. Check your connection and try again.";
    }
}
