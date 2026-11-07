import type { OrgRole, ProjectRole } from './enums.js';

/**
 * Ma trận quyền (docs/01 §9, docs/05 §3). Dùng chung cho backend (AccessService)
 * và frontend (useCan). Action `org.*` xét theo role tổ chức; `project.*` xét theo
 * role hiệu lực trong project = max(org_role, project_role).
 */
export type Role = OrgRole;

const ALL: Role[] = ['OWNER', 'ADMIN', 'QA_LEAD', 'TESTER', 'DEVELOPER', 'VIEWER'];
const ADMINS: Role[] = ['OWNER', 'ADMIN'];
const LEADS: Role[] = ['OWNER', 'ADMIN', 'QA_LEAD'];

export const PERMISSIONS = {
  // cấp tổ chức
  'org.read': ALL,
  'org.update': ADMINS,
  'org.members.manage': ADMINS,
  'org.testingSwitches': ADMINS,
  'org.localNetwork': ADMINS,
  'org.serviceAccounts': ADMINS,
  'org.audit.read': ADMINS,
  'org.audit.export': ['OWNER'],
  'org.targets.read': ALL,
  'org.targets.manage': ADMINS,
  'org.secrets.read': LEADS,
  'org.secrets.write': ADMINS, // secret cấp tổ chức (không gắn project)
  'org.secrets.delete': ADMINS,
  'org.projects.create': ADMINS,
  // cấp project
  'project.read': ALL,
  'project.update': LEADS,
  'project.archive': ADMINS,
  'project.members.manage': LEADS,
  'project.environments.manage': LEADS,
  'project.environments.delete': ADMINS,
  'project.environments.production': ADMINS, // đổi kind sang/khỏi PRODUCTION, bật/tắt test PRODUCTION
  'project.environments.testingToggle': LEADS,
  'project.secrets.read': LEADS,
  'project.secrets.write': LEADS,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

const RANK: Record<Role, number> = {
  OWNER: 6,
  ADMIN: 5,
  QA_LEAD: 4,
  TESTER: 3,
  DEVELOPER: 3,
  VIEWER: 1,
};

/** Role hiệu lực trong project; null = không thấy project (trả 404) */
export function effectiveProjectRole(
  orgRole: OrgRole,
  projectRole: ProjectRole | null | undefined,
): Role | null {
  if (orgRole === 'OWNER' || orgRole === 'ADMIN') return orgRole;
  if (!projectRole) return null;
  return RANK[orgRole] > RANK[projectRole] ? orgRole : projectRole;
}

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && (PERMISSIONS[action] as readonly Role[]).includes(role);
}
