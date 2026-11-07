import { z } from 'zod';
import {
  ENVIRONMENT_KINDS,
  ORG_ROLES,
  PROJECT_ROLES,
  SERVICE_ACCOUNT_SCOPES,
  VERIFICATION_METHODS,
} from './enums.js';

// docs/09 §3: tối thiểu 10 ký tự, không bắt quy tắc ký tự phức tạp
export const passwordSchema = z.string().min(10, 'Mật khẩu tối thiểu 10 ký tự').max(200);
export const emailSchema = z
  .email()
  .max(254)
  .transform((e) => e.toLowerCase());
const name = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(10, 'Lý do tối thiểu 10 ký tự').max(500);
const httpUrl = z
  .url({ protocol: /^https?$/, error: 'URL không hợp lệ (cần bắt đầu bằng http:// hoặc https://)' })
  .max(2000);
// Ô URL không bắt buộc: form gửi chuỗi rỗng khi để trống → coi như không nhập
const optionalUrl = z.union([z.literal('').transform(() => undefined), httpUrl]).optional();
const timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Timezone không hợp lệ');

// ---- Auth ----
export const setupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: name,
  organizationName: name,
});
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export const updateMeSchema = z
  .object({ displayName: name, locale: z.enum(['vi', 'en']), timezone })
  .partial();

// ---- Organization ----
export const updateOrganizationSchema = z.object({ name, defaultTimezone: timezone }).partial();
export const testingSwitchesSchema = z
  .object({
    productionTesting: z.boolean().optional(),
    localTesting: z.boolean().optional(),
    reason,
    stopRunning: z.boolean().optional(),
  })
  .refine((v) => v.productionTesting !== undefined || v.localTesting !== undefined, {
    message: 'Cần ít nhất một công tắc',
  });
export const addMemberSchema = z.object({
  email: emailSchema,
  displayName: name,
  role: z.enum(ORG_ROLES),
});
export const updateMemberSchema = z.object({ role: z.enum(ORG_ROLES) });

const cidr = z.string().refine((v) => /^[0-9a-fA-F:.]+\/\d{1,3}$/.test(v), 'CIDR không hợp lệ');
export const localNetworkSchema = z.object({
  allowedCidrs: z.array(cidr).max(50),
  allowLoopback: z.boolean(),
});

export const createServiceAccountSchema = z.object({
  name,
  scopes: z.array(z.enum(SERVICE_ACCOUNT_SCOPES)).min(1),
  projectIds: z.array(z.uuid()).nullable().default(null),
  expiresInDays: z.number().int().min(1).max(730).default(365),
});
export const updateServiceAccountSchema = z
  .object({
    name,
    scopes: z.array(z.enum(SERVICE_ACCOUNT_SCOPES)).min(1),
    projectIds: z.array(z.uuid()).nullable(),
  })
  .partial();

// ---- Project ----
export const createProjectSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Mã dự án: 2–10 ký tự IN HOA/số, bắt đầu bằng chữ'),
  name,
  description: z.string().max(2000).optional(),
  repositoryUrl: optionalUrl,
});
export const updateProjectSchema = createProjectSchema.omit({ key: true }).partial();
export const projectMemberSchema = z.object({ userId: z.uuid(), role: z.enum(PROJECT_ROLES) });
export const updateProjectMemberSchema = z.object({ role: z.enum(PROJECT_ROLES) });

// ---- Environment ----
const headers = z.record(z.string().max(200), z.string().max(4000));
export const createEnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(ENVIRONMENT_KINDS),
  webBaseUrl: optionalUrl,
  apiBaseUrl: optionalUrl,
  defaultHeaders: headers.default({}),
});
export const updateEnvironmentSchema = createEnvironmentSchema
  .extend({ isActive: z.boolean() })
  .partial();
export const toggleTestingSchema = z.object({
  enabled: z.boolean(),
  reason,
  stopRunning: z.boolean().optional(),
});
export const environmentVariablesSchema = z
  .array(
    z.union([
      z.object({ key: z.string().regex(/^[A-Za-z_][\w.]{0,99}$/), value: z.string().max(4000) }),
      z.object({ key: z.string().regex(/^[A-Za-z_][\w.]{0,99}$/), secretId: z.uuid() }),
    ]),
  )
  .max(200)
  .refine((vars) => new Set(vars.map((v) => v.key)).size === vars.length, 'Trùng key');
export const createCredentialSchema = z.object({
  roleName: z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/, 'Tên vai trò: chữ thường, số, - _'),
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});
export const updateCredentialSchema = createCredentialSchema.omit({ roleName: true }).partial();

// ---- Secret ----
export const createSecretSchema = z.object({
  name: z.string().regex(/^[A-Za-z][\w.-]{0,99}$/, 'Tên secret không hợp lệ'),
  value: z.string().min(1).max(10_000),
  projectId: z.uuid().optional(),
});
export const updateSecretSchema = z.object({ value: z.string().min(1).max(10_000) });

// ---- Target ----
const hostPattern = z
  .string()
  .toLowerCase()
  .regex(
    /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/,
    'Host không hợp lệ (vd. staging.example.com, *.example.vn)',
  );
export const createTargetSchema = z
  .object({
    hostPattern,
    projectId: z.uuid().optional(),
    verificationMethod: z.enum(VERIFICATION_METHODS),
    allowPrivateNetwork: z.boolean().default(false),
    allowedCidrs: z.array(cidr).max(20).default([]),
  })
  .refine((t) => !t.hostPattern.startsWith('*.') || t.verificationMethod === 'DNS_TXT', {
    message: 'Wildcard chỉ dùng với DNS_TXT',
    path: ['hostPattern'],
  })
  .refine((t) => !t.allowPrivateNetwork || t.allowedCidrs.length > 0, {
    message: 'allow_private_network bắt buộc có allowedCidrs',
    path: ['allowedCidrs'],
  });
export const approveTargetSchema = z.object({ reason });
