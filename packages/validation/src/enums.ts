// Enum đồng bộ với pgEnum ở apps/api/src/db/schema (docs/04 §2)
export const ORG_ROLES = ['OWNER', 'ADMIN', 'QA_LEAD', 'TESTER', 'DEVELOPER', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PROJECT_ROLES = ['QA_LEAD', 'TESTER', 'DEVELOPER', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ENVIRONMENT_KINDS = ['LOCAL', 'DEV', 'STAGING', 'PRODUCTION'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const VERIFICATION_METHODS = ['DNS_TXT', 'WELL_KNOWN_FILE', 'ADMIN_APPROVAL'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const SERVICE_ACCOUNT_SCOPES = [
  'runs:create',
  'runs:read',
  'results:import',
  'gates:read',
  'findings:read',
  'findings:write',
] as const;
export type ServiceAccountScope = (typeof SERVICE_ACCOUNT_SCOPES)[number];

export const USER_STATUSES = ['ACTIVE', 'LOCKED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
