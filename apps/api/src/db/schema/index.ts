// Schema theo docs/04. Phase 1: tài khoản, tổ chức, dự án, môi trường, secret, target, audit.

import {
  boolean,
  cidr,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ENVIRONMENT_KINDS, ORG_ROLES, PROJECT_ROLES, USER_STATUSES } from '@qah/validation';
import { uuidv7 } from '../uuid';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const id = () => uuid('id').primaryKey().$defaultFn(uuidv7);
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const orgRole = pgEnum('org_role', ORG_ROLES);
export const projectRole = pgEnum('project_role', PROJECT_ROLES);
export const environmentKind = pgEnum('environment_kind', ENVIRONMENT_KINDS);
export const userStatus = pgEnum('user_status', USER_STATUSES);
export const verificationMethod = pgEnum('verification_method', [
  'DNS_TXT',
  'WELL_KNOWN_FILE',
  'ADMIN_APPROVAL',
]);

// ---- Tài khoản và tổ chức (docs/04 §3) ----
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull().default('vi'),
  timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
  settings: jsonb('settings').notNull().default({}),
  status: userStatus('status').notNull().default('ACTIVE'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(), // = claim `sid` trong JWT
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId), index().on(t.familyId)],
);

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  defaultTimezone: text('default_timezone').notNull().default('Asia/Ho_Chi_Minh'),
  settings: jsonb('settings').notNull().default({}), // { localNetwork: { allowedCidrs, allowLoopback } }
  // D-24: cột riêng vì API, worker, scheduler đều kiểm trước mỗi lần chạy
  productionTestingEnabled: boolean('production_testing_enabled').notNull().default(false),
  localTestingEnabled: boolean('local_testing_enabled').notNull().default(true),
  testingSwitchesChangedBy: uuid('testing_switches_changed_by').references(() => users.id),
  testingSwitchesChangedAt: ts('testing_switches_changed_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull(),
    joinedAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.userId)],
);

// Lời mời qua email: API ở Phase 8 (kiểu Máy chủ); bảng tạo sẵn theo docs/12 mục 1.1
export const invitations = pgTable('invitations', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: orgRole('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by').references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt: createdAt(),
});

export const serviceAccounts = pgTable('service_accounts', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenPrefix: text('token_prefix').notNull().unique(),
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  projectIds: uuid('project_ids').array(), // null = mọi project trong org
  lastUsedAt: ts('last_used_at'),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

// ---- Dự án, môi trường, secret, target (docs/04 §4) ----
export const projects = pgTable(
  'projects',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    repositoryUrl: text('repository_url'),
    technologyMetadata: jsonb('technology_metadata').notNull().default({}),
    settings: jsonb('settings').notNull().default({}),
    archivedAt: ts('archived_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.key)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.projectId, t.userId)],
);

export const secrets = pgTable(
  'secrets',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id').references(() => projects.id),
    name: text('name').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    iv: bytea('iv').notNull(),
    authTag: bytea('auth_tag').notNull(),
    keyVersion: text('key_version').notNull(),
    lastRotatedAt: ts('last_rotated_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.organizationId, t.projectId, t.name).nullsNotDistinct()],
);

export const environments = pgTable(
  'environments',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    kind: environmentKind('kind').notNull(),
    webBaseUrl: text('web_base_url'),
    apiBaseUrl: text('api_base_url'),
    testingEnabled: boolean('testing_enabled').notNull().default(true),
    testingDisabledReason: text('testing_disabled_reason'),
    testingToggledBy: uuid('testing_toggled_by').references(() => users.id),
    testingToggledAt: ts('testing_toggled_at'),
    defaultHeaders: jsonb('default_headers').notNull().default({}),
    configMetadata: jsonb('config_metadata').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.projectId, t.name)],
);

export const environmentVariables = pgTable(
  'environment_variables',
  {
    id: id(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value'),
    secretId: uuid('secret_id').references(() => secrets.id),
  },
  (t) => [uniqueIndex().on(t.environmentId, t.key)],
);

export const environmentCredentials = pgTable(
  'environment_credentials',
  {
    id: id(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    roleName: text('role_name').notNull(),
    username: text('username').notNull(),
    passwordSecretId: uuid('password_secret_id')
      .notNull()
      .references(() => secrets.id),
    loginFlowId: uuid('login_flow_id'), // FK tới shared_flows thêm ở Phase 5
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.environmentId, t.roleName)],
);

export const targetHosts = pgTable(
  'target_hosts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id').references(() => projects.id),
    hostPattern: text('host_pattern').notNull(),
    allowPrivateNetwork: boolean('allow_private_network').notNull().default(false),
    allowedCidrs: cidr('allowed_cidrs').array(),
    verificationMethod: verificationMethod('verification_method').notNull(),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by').references(() => users.id),
    expiresAt: ts('expires_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.hostPattern)],
);

// shortcut: chưa phân vùng theo tháng; làm ở Phase 8 (mục 8.8 phân vùng bảng)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    actorUserId: uuid('actor_user_id'),
    actorServiceAccountId: uuid('actor_service_account_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.organizationId, t.createdAt.desc()),
    index().on(t.entityType, t.entityId),
    index().on(t.action),
  ],
);
