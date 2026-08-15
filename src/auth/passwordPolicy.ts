import type { TranslateParams, TranslationKey } from "../i18n/translate";
import type { TranslateFn } from "../i18n/translateFn";

// Verified against the real Cognito user pool via `aws cognito-idp describe-user-pool` run from
// CloudShell in the correct AWS account. This is the single source of truth for password
// validation on the client — both the live signup checklist and submit-button gating read from
// this same object, so they can never drift out of sync with each other. Cognito's
// TemporaryPasswordValidityDays (7) is also part of the verified policy but is intentionally not
// modeled here or shown in normal signup UI — it governs admin-created temporary passwords, not
// the self-service signup flow.
export const PASSWORD_POLICY = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireNumbers: true,
  requireSymbols: true,
};

// Translation-free definitions — `met` is the actual validation logic (used by isPasswordValid
// below, which must never depend on a translator being available), and `labelKey`/`labelParams`
// describe what a UI should display without resolving it. Keeping this pure/untranslated is what
// lets isPasswordValid stay a plain, always-callable function.
export type PasswordRequirementDefinition = {
  key: string;
  labelKey: TranslationKey;
  labelParams?: TranslateParams;
  met: (password: string) => boolean;
};

export function getPasswordRequirementDefinitions(
  policy: typeof PASSWORD_POLICY = PASSWORD_POLICY
): PasswordRequirementDefinition[] {
  const requirements: PasswordRequirementDefinition[] = [
    {
      key: "minLength",
      labelKey: "auth.passwordRequirements.minLength",
      labelParams: { minLength: policy.minLength },
      met: (password) => password.length >= policy.minLength,
    },
  ];

  if (policy.requireLowercase) {
    requirements.push({
      key: "lowercase",
      labelKey: "auth.passwordRequirements.lowercase",
      met: (password) => /[a-z]/.test(password),
    });
  }
  if (policy.requireUppercase) {
    requirements.push({
      key: "uppercase",
      labelKey: "auth.passwordRequirements.uppercase",
      met: (password) => /[A-Z]/.test(password),
    });
  }
  if (policy.requireNumbers) {
    requirements.push({
      key: "number",
      labelKey: "auth.passwordRequirements.number",
      met: (password) => /[0-9]/.test(password),
    });
  }
  if (policy.requireSymbols) {
    requirements.push({
      key: "symbol",
      labelKey: "auth.passwordRequirements.symbol",
      met: (password) => /[^A-Za-z0-9]/.test(password),
    });
  }

  return requirements;
}

export type PasswordRequirement = {
  key: string;
  label: string;
  met: (password: string) => boolean;
};

// Display-ready version for the live signup/change-password checklist — resolves each
// definition's labelKey through the caller's own translator rather than this module importing
// the i18n runtime itself (same TranslateFn-parameter pattern as src/content/timeGreeting.ts).
export function getPasswordRequirements(
  t: TranslateFn,
  policy: typeof PASSWORD_POLICY = PASSWORD_POLICY
): PasswordRequirement[] {
  return getPasswordRequirementDefinitions(policy).map((requirement) => ({
    key: requirement.key,
    label: t(requirement.labelKey, requirement.labelParams),
    met: requirement.met,
  }));
}

export function isPasswordValid(
  password: string,
  policy: typeof PASSWORD_POLICY = PASSWORD_POLICY
): boolean {
  return getPasswordRequirementDefinitions(policy).every((requirement) => requirement.met(password));
}
