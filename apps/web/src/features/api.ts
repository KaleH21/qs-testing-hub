import type {
  EnvironmentKind,
  OrgRole,
  ProjectRole,
  ServiceAccountScope,
  VerificationMethod,
} from '@qah/validation';
import { baseApi } from '@/lib/api';

// Kiểu dữ liệu trả về từ API Phase 1 (docs/05 §3.1–3.3)
export interface Me {
  user: { id: string; email: string; displayName: string; locale: 'vi' | 'en'; timezone: string };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: OrgRole;
    projects: Array<{ projectId: string; role: ProjectRole }>;
  }>;
}
export interface Organization {
  id: string;
  name: string;
  defaultTimezone: string;
  productionTestingEnabled: boolean;
  localTestingEnabled: boolean;
  testingSwitchesChangedAt: string | null;
  localNetwork: { allowedCidrs: string[]; allowLoopback: boolean };
}
export interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: OrgRole;
  status?: string;
}
export interface ServiceAccount {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: ServiceAccountScope[];
  projectIds: string[] | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  token?: string;
}
export interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  myRole?: OrgRole;
}
export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  role: ProjectRole;
}
export interface TestingBlock {
  code: string;
  blockedBy: 'ORGANIZATION' | 'ENVIRONMENT';
  message: string;
  reason?: string | null;
}
export interface Environment {
  id: string;
  projectId: string;
  name: string;
  kind: EnvironmentKind;
  webBaseUrl: string | null;
  apiBaseUrl: string | null;
  isActive: boolean;
  testingEnabled: boolean;
  testingDisabledReason: string | null;
  testingToggledAt: string | null;
  testingBlock: TestingBlock | null;
}
export type Variable = { key: string; value?: string | null; secretId?: string; masked?: boolean };
export interface Credential {
  id: string;
  roleName: string;
  username: string;
}
export interface Secret {
  id: string;
  name: string;
  projectId: string | null;
  createdAt: string;
}
export interface Target {
  id: string;
  hostPattern: string;
  verificationMethod: VerificationMethod;
  allowPrivateNetwork: boolean;
  allowedCidrs: string[];
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED';
  expiresAt: string | null;
  verificationToken?: string;
  instructions: {
    dnsTxt?: { name: string; value: string };
    file?: { url: string; content: string };
    adminApproval?: boolean;
  };
}
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}
type List<T> = { data: T[]; nextCursor?: string | null };
type Body = Record<string, unknown>;

export const api = baseApi.injectEndpoints({
  endpoints: (b) => ({
    // ---- Auth ----
    setupStatus: b.query<{ needsSetup: boolean; deploymentMode: string }, void>({
      query: () => 'setup',
    }),
    setup: b.mutation<{ accessToken: string }, Body>({
      query: (body) => ({ url: 'setup', method: 'POST', body }),
    }),
    login: b.mutation<{ accessToken: string }, Body>({
      query: (body) => ({ url: 'auth/login', method: 'POST', body }),
    }),
    logout: b.mutation<void, void>({ query: () => ({ url: 'auth/logout', method: 'POST' }) }),
    me: b.query<Me, void>({ query: () => 'auth/me', providesTags: ['Me'] }),
    updateMe: b.mutation<Me, Body>({
      query: (body) => ({ url: 'auth/me', method: 'PATCH', body }),
      invalidatesTags: ['Me'],
    }),
    changePassword: b.mutation<void, Body>({
      query: (body) => ({ url: 'auth/change-password', method: 'POST', body }),
    }),

    // ---- Tổ chức ----
    organization: b.query<Organization, string>({
      query: (id) => `organizations/${id}`,
      providesTags: ['Org'],
    }),
    updateOrganization: b.mutation<Organization, { id: string } & Body>({
      query: ({ id, ...body }) => ({ url: `organizations/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Org', 'Me', 'Audit'],
    }),
    testingSwitches: b.mutation<Organization, { id: string } & Body>({
      query: ({ id, ...body }) => ({
        url: `organizations/${id}/testing-switches`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Org', 'Environment', 'Audit'],
    }),
    localNetwork: b.mutation<Organization, { id: string } & Body>({
      query: ({ id, ...body }) => ({
        url: `organizations/${id}/local-network`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: ['Org', 'Audit'],
    }),
    members: b.query<List<Member>, string>({
      query: (id) => `organizations/${id}/members`,
      providesTags: ['Member'],
    }),
    addMember: b.mutation<Member & { temporaryPassword: string | null }, { orgId: string } & Body>({
      query: ({ orgId, ...body }) => ({
        url: `organizations/${orgId}/members`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Member', 'Audit'],
    }),
    updateMember: b.mutation<void, { orgId: string; userId: string; role: OrgRole }>({
      query: ({ orgId, userId, role }) => ({
        url: `organizations/${orgId}/members/${userId}`,
        method: 'PATCH',
        body: { role },
      }),
      invalidatesTags: ['Member', 'Audit'],
    }),
    removeMember: b.mutation<void, { orgId: string; userId: string }>({
      query: ({ orgId, userId }) => ({
        url: `organizations/${orgId}/members/${userId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Member', 'Audit'],
    }),

    // ---- Service account ----
    serviceAccounts: b.query<List<ServiceAccount>, void>({
      query: () => 'service-accounts',
      providesTags: ['ServiceAccount'],
    }),
    createServiceAccount: b.mutation<ServiceAccount, Body>({
      query: (body) => ({ url: 'service-accounts', method: 'POST', body }),
      invalidatesTags: ['ServiceAccount', 'Audit'],
    }),
    rotateServiceAccount: b.mutation<ServiceAccount, string>({
      query: (id) => ({ url: `service-accounts/${id}/rotate`, method: 'POST' }),
      invalidatesTags: ['ServiceAccount', 'Audit'],
    }),
    revokeServiceAccount: b.mutation<void, string>({
      query: (id) => ({ url: `service-accounts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ServiceAccount', 'Audit'],
    }),

    // ---- Dự án ----
    projects: b.query<List<Project>, { archived?: boolean } | void>({
      query: (a) => ({ url: 'projects', params: a?.archived ? { archived: 'true' } : undefined }),
      providesTags: ['Project'],
    }),
    project: b.query<Project, string>({
      query: (id) => `projects/${id}`,
      providesTags: ['Project'],
    }),
    createProject: b.mutation<Project, Body>({
      query: (body) => ({ url: 'projects', method: 'POST', body }),
      invalidatesTags: ['Project', 'Audit'],
    }),
    updateProject: b.mutation<Project, { id: string } & Body>({
      query: ({ id, ...body }) => ({ url: `projects/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Project', 'Audit'],
    }),
    archiveProject: b.mutation<Project, { id: string; archived: boolean }>({
      query: ({ id, archived }) => ({
        url: `projects/${id}/${archived ? 'archive' : 'unarchive'}`,
        method: 'POST',
      }),
      invalidatesTags: ['Project', 'Audit'],
    }),
    projectMembers: b.query<List<ProjectMember>, string>({
      query: (id) => `projects/${id}/members`,
      providesTags: ['ProjectMember'],
    }),
    addProjectMember: b.mutation<void, { projectId: string; userId: string; role: ProjectRole }>({
      query: ({ projectId, ...body }) => ({
        url: `projects/${projectId}/members`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['ProjectMember', 'Me', 'Audit'],
    }),
    updateProjectMember: b.mutation<void, { projectId: string; userId: string; role: ProjectRole }>(
      {
        query: ({ projectId, userId, role }) => ({
          url: `projects/${projectId}/members/${userId}`,
          method: 'PATCH',
          body: { role },
        }),
        invalidatesTags: ['ProjectMember', 'Me', 'Audit'],
      },
    ),
    removeProjectMember: b.mutation<void, { projectId: string; userId: string }>({
      query: ({ projectId, userId }) => ({
        url: `projects/${projectId}/members/${userId}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['ProjectMember', 'Me', 'Audit'],
    }),

    // ---- Môi trường ----
    environments: b.query<List<Environment>, string>({
      query: (pid) => `projects/${pid}/environments`,
      providesTags: ['Environment'],
    }),
    createEnvironment: b.mutation<Environment, { projectId: string } & Body>({
      query: ({ projectId, ...body }) => ({
        url: `projects/${projectId}/environments`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Environment', 'Audit'],
    }),
    updateEnvironment: b.mutation<Environment, { id: string } & Body>({
      query: ({ id, ...body }) => ({ url: `environments/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Environment', 'Audit'],
    }),
    deleteEnvironment: b.mutation<void, string>({
      query: (id) => ({ url: `environments/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Environment', 'Audit'],
    }),
    toggleTesting: b.mutation<Environment, { id: string; enabled: boolean; reason: string }>({
      query: ({ id, ...body }) => ({ url: `environments/${id}/testing`, method: 'PATCH', body }),
      invalidatesTags: ['Environment', 'Audit'],
    }),
    variables: b.query<List<Variable>, string>({
      query: (id) => `environments/${id}/variables`,
      providesTags: ['Variable'],
    }),
    saveVariables: b.mutation<List<Variable>, { id: string; vars: Variable[] }>({
      query: ({ id, vars }) => ({ url: `environments/${id}/variables`, method: 'PUT', body: vars }),
      invalidatesTags: ['Variable', 'Audit'],
    }),
    credentials: b.query<List<Credential>, string>({
      query: (id) => `environments/${id}/credentials`,
      providesTags: ['Credential'],
    }),
    createCredential: b.mutation<Credential, { envId: string } & Body>({
      query: ({ envId, ...body }) => ({
        url: `environments/${envId}/credentials`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Credential', 'Audit'],
    }),
    deleteCredential: b.mutation<void, { envId: string; id: string }>({
      query: ({ envId, id }) => ({
        url: `environments/${envId}/credentials/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Credential', 'Audit'],
    }),
    secrets: b.query<List<Secret>, string | void>({
      query: (projectId) => ({ url: 'secrets', params: projectId ? { projectId } : undefined }),
      providesTags: ['Secret'],
    }),
    createSecret: b.mutation<Secret, Body>({
      query: (body) => ({ url: 'secrets', method: 'POST', body }),
      invalidatesTags: ['Secret', 'Audit'],
    }),

    // ---- Allowlist ----
    targets: b.query<List<Target>, void>({ query: () => 'targets', providesTags: ['Target'] }),
    createTarget: b.mutation<Target, Body>({
      query: (body) => ({ url: 'targets', method: 'POST', body }),
      invalidatesTags: ['Target', 'Audit'],
    }),
    verifyTarget: b.mutation<Target, string>({
      query: (id) => ({ url: `targets/${id}/verify`, method: 'POST' }),
      invalidatesTags: ['Target', 'Audit'],
    }),
    approveTarget: b.mutation<Target, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `targets/${id}/approve`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: ['Target', 'Audit'],
    }),
    deleteTarget: b.mutation<void, string>({
      query: (id) => ({ url: `targets/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Target', 'Audit'],
    }),

    // ---- Audit ----
    auditLogs: b.query<List<AuditEntry>, { action?: string; cursor?: string }>({
      query: (params) => ({ url: 'audit-logs', params: { ...params, limit: 50 } }),
      providesTags: ['Audit'],
    }),
  }),
});

export const {
  useSetupStatusQuery,
  useSetupMutation,
  useLoginMutation,
  useLogoutMutation,
  useMeQuery,
  useUpdateMeMutation,
  useChangePasswordMutation,
  useOrganizationQuery,
  useUpdateOrganizationMutation,
  useTestingSwitchesMutation,
  useLocalNetworkMutation,
  useMembersQuery,
  useAddMemberMutation,
  useUpdateMemberMutation,
  useRemoveMemberMutation,
  useServiceAccountsQuery,
  useCreateServiceAccountMutation,
  useRotateServiceAccountMutation,
  useRevokeServiceAccountMutation,
  useProjectsQuery,
  useProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useArchiveProjectMutation,
  useProjectMembersQuery,
  useAddProjectMemberMutation,
  useUpdateProjectMemberMutation,
  useRemoveProjectMemberMutation,
  useEnvironmentsQuery,
  useCreateEnvironmentMutation,
  useUpdateEnvironmentMutation,
  useDeleteEnvironmentMutation,
  useToggleTestingMutation,
  useVariablesQuery,
  useSaveVariablesMutation,
  useCredentialsQuery,
  useCreateCredentialMutation,
  useDeleteCredentialMutation,
  useSecretsQuery,
  useCreateSecretMutation,
  useTargetsQuery,
  useCreateTargetMutation,
  useVerifyTargetMutation,
  useApproveTargetMutation,
  useDeleteTargetMutation,
  useAuditLogsQuery,
} = api;
