import { getAuthErrorCode, isAuthNetworkError } from "./AuthService";

// Maps Cognito's exception codes to plain-language, user-safe text. Cognito's raw messages are
// technical, inconsistent in tone, and can reveal internal details — never surface them
// directly. Deliberately vague for auth-outcome exceptions (NotAuthorizedException /
// UserNotFoundException both map to the same "incorrect email or password" text) to avoid
// leaking whether a given email has an account.
const FRIENDLY_MESSAGES: Record<string, string> = {
  UsernameExistsException: "An account with this email already exists.",
  NotAuthorizedException: "Incorrect email or password.",
  UserNotFoundException: "Incorrect email or password.",
  UserNotConfirmedException:
    "This account hasn't been confirmed yet. Check your email for a confirmation code.",
  CodeMismatchException: "That confirmation code doesn't match. Please check and try again.",
  ExpiredCodeException: "That confirmation code has expired. Request a new one and try again.",
  InvalidPasswordException: "That password doesn't meet the requirements below.",
  InvalidParameterException: "Please check the details you entered and try again.",
  LimitExceededException: "Too many attempts. Please wait a moment and try again.",
  TooManyRequestsException: "Too many attempts. Please wait a moment and try again.",
  AliasExistsException: "An account with this email already exists.",
};

const GENERIC_FALLBACK = "Something went wrong. Please try again.";
const NETWORK_FALLBACK = "Unable to reach the server. Check your connection and try again.";

/** User-facing, friendly message for an error thrown by AuthService — never the raw Cognito text. */
export function mapAuthError(error: unknown): string {
  if (isAuthNetworkError(error)) return NETWORK_FALLBACK;
  const code = getAuthErrorCode(error);
  if (code && FRIENDLY_MESSAGES[code]) return FRIENDLY_MESSAGES[code];
  return GENERIC_FALLBACK;
}

/**
 * Safe to log for debugging: a Cognito exception code, "NetworkError", or a generic error
 * class name — never the raw message, which may embed details we don't want in logs.
 */
export function getAuthDiagnosticCode(error: unknown): string {
  if (isAuthNetworkError(error)) return "NetworkError";
  return getAuthErrorCode(error) ?? (error instanceof Error ? error.constructor.name : "UnknownError");
}
