import { ChangePasswordUnauthenticatedError, getAuthErrorCode, getAuthErrorStatus, isAuthNetworkError } from "./AuthService";

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

// Stable, untranslated semantic outcome for a changePassword() failure — deliberately NOT a
// user-facing string. Cognito's NotAuthorizedException means something different here than it
// does during sign-in (during sign-in it's intentionally vague "incorrect email or password" to
// avoid leaking account existence; here, coming from an already-authenticated user, it can only
// mean the typed current password was wrong), so this is a wholly separate mapping from
// mapAuthError/FRIENDLY_MESSAGES above, not a reuse of it.
//
// The actual user-facing message is produced at the UI boundary (app/change-password.tsx) via
// t(`changePassword.error.${kind}`) — this keeps low-level auth transport code (this file, and
// AuthService.ts beneath it) free of any dependency on the i18n/React layer, while still letting
// both English and Spanish render a real, localized message instead of a hardcoded literal.
export type ChangePasswordErrorKind =
  | "incorrectCurrentPassword"
  | "policyFailure"
  | "invalidDetails"
  | "rateLimited"
  | "network"
  | "temporaryService"
  | "unauthenticated"
  | "unexpected";

const CHANGE_PASSWORD_ERROR_KINDS: Record<string, ChangePasswordErrorKind> = {
  NotAuthorizedException: "incorrectCurrentPassword",
  InvalidPasswordException: "policyFailure",
  InvalidParameterException: "invalidDetails",
  LimitExceededException: "rateLimited",
  TooManyRequestsException: "rateLimited",
};

/**
 * Classifies an error thrown by AuthService.changePassword into a stable, translatable outcome.
 * Never returns or embeds the raw Cognito message — only a fixed set of semantic kinds.
 */
export function getChangePasswordErrorKind(error: unknown): ChangePasswordErrorKind {
  if (error instanceof ChangePasswordUnauthenticatedError) return "unauthenticated";
  if (isAuthNetworkError(error)) return "network";
  const code = getAuthErrorCode(error);
  if (code && CHANGE_PASSWORD_ERROR_KINDS[code]) return CHANGE_PASSWORD_ERROR_KINDS[code];
  const status = getAuthErrorStatus(error);
  if (status !== undefined && status >= 500) return "temporaryService";
  return "unexpected";
}

/**
 * Safe to log for debugging: a Cognito exception code, "NetworkError", or a generic error
 * class name — never the raw message, which may embed details we don't want in logs.
 */
export function getAuthDiagnosticCode(error: unknown): string {
  if (isAuthNetworkError(error)) return "NetworkError";
  return getAuthErrorCode(error) ?? (error instanceof Error ? error.constructor.name : "UnknownError");
}
