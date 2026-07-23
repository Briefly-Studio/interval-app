// Verified against the real Cognito user pool (us-east-2_UwGRm5dye) via
// `aws cognito-idp describe-user-pool` run from CloudShell in the correct AWS account.
// This is the single source of truth for password validation on the client — both the live
// signup checklist and submit-button gating read from this same object, so they can never
// drift out of sync with each other. Cognito's TemporaryPasswordValidityDays (7) is also part
// of the verified policy but is intentionally not modeled here or shown in normal signup UI —
// it governs admin-created temporary passwords, not the self-service signup flow.
export const PASSWORD_POLICY = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireNumbers: true,
  requireSymbols: true,
};

export type PasswordRequirement = {
  key: string;
  label: string;
  met: (password: string) => boolean;
};

export function getPasswordRequirements(
  policy: typeof PASSWORD_POLICY = PASSWORD_POLICY
): PasswordRequirement[] {
  const requirements: PasswordRequirement[] = [
    {
      key: "minLength",
      label: `At least ${policy.minLength} characters`,
      met: (password) => password.length >= policy.minLength,
    },
  ];

  if (policy.requireLowercase) {
    requirements.push({
      key: "lowercase",
      label: "A lowercase letter",
      met: (password) => /[a-z]/.test(password),
    });
  }
  if (policy.requireUppercase) {
    requirements.push({
      key: "uppercase",
      label: "An uppercase letter",
      met: (password) => /[A-Z]/.test(password),
    });
  }
  if (policy.requireNumbers) {
    requirements.push({
      key: "number",
      label: "A number",
      met: (password) => /[0-9]/.test(password),
    });
  }
  if (policy.requireSymbols) {
    requirements.push({
      key: "symbol",
      label: "A symbol (e.g. ! @ # $ %)",
      met: (password) => /[^A-Za-z0-9]/.test(password),
    });
  }

  return requirements;
}

export function isPasswordValid(
  password: string,
  policy: typeof PASSWORD_POLICY = PASSWORD_POLICY
): boolean {
  return getPasswordRequirements(policy).every((requirement) => requirement.met(password));
}
