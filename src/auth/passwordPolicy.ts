// ============================================================================================
// ⚠ UNVERIFIED — NOT YET CONFIRMED against the real Cognito user pool (us-east-2_UwGRm5dye).
//
// The values below are AWS Cognito's documented *default* password policy for a newly created
// user pool. This project's actual pool may have been customized and could disagree with
// these values (e.g. a longer minimum length, or a symbol requirement).
//
// To confirm: run
//   aws cognito-idp describe-user-pool --user-pool-id us-east-2_UwGRm5dye --region us-east-2
// and read `UserPool.Policies.PasswordPolicy`. Update PASSWORD_POLICY below to match exactly,
// then remove this warning banner.
// ============================================================================================
export const PASSWORD_POLICY = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireNumbers: true,
  requireSymbols: false,
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
