import { zodResolver } from '@hookform/resolvers/zod';
import {
  createCredentialSchema,
  createEnvironmentSchema,
  createProjectSchema,
  ENVIRONMENT_KINDS,
  PROJECT_ROLES,
  type ProjectRole,
} from '@qah/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  EnvBadge,
  ErrorText,
  Field,
  PageHeader,
  QueryState,
  ReasonDialog,
} from '@/components/common';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useAddProjectMemberMutation,
  useArchiveProjectMutation,
  useCreateCredentialMutation,
  useCreateEnvironmentMutation,
  useCreateProjectMutation,
  useCredentialsQuery,
  useDeleteCredentialMutation,
  useDeleteEnvironmentMutation,
  useEnvironmentsQuery,
  useMembersQuery,
  useProjectMembersQuery,
  useProjectsQuery,
  useRemoveProjectMemberMutation,
  useSaveVariablesMutation,
  useSecretsQuery,
  useToggleTestingMutation,
  useUpdateProjectMemberMutation,
  useVariablesQuery,
  type Environment,
  type Project,
  type Variable,
} from '@/features/api';
import { useCan, useCurrentOrg } from '@/lib/session';
import { cn } from '@/lib/utils';

// ---- Danh sách dự án ----
export function ProjectsPage() {
  const { t } = useTranslation();
  const [archived, setArchived] = useState(false);
  const q = useProjectsQuery({ archived });
  const canCreate = useCan('org.projects.create');
  return (
    <div>
      <PageHeader title={t('projects.title')} actions={canCreate && <CreateProjectDialog />} />
      <label className="mb-4 flex items-center gap-2 text-sm">
        <Switch
          checked={archived}
          onCheckedChange={setArchived}
          aria-label={t('projects.showArchived')}
        />
        {t('projects.showArchived')}
      </label>
      <QueryState
        query={q}
        empty={{
          when: (d) => !d.data.length,
          text: canCreate ? t('projects.emptyAdmin') : t('projects.empty'),
          action: canCreate && <CreateProjectDialog />,
        }}
      >
        {(d) => (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.data.map((p) => (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{p.name}</span>
                    <code className="text-muted-foreground text-xs">{p.key}</code>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {p.description && (
                    <p className="text-muted-foreground text-sm">{p.description}</p>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/p/${p.key}/settings`}>{t('projects.settings')}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function CreateProjectDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [create, res] = useCreateProjectMutation();
  const form = useForm<z.input<typeof createProjectSchema>>({
    resolver: zodResolver(createProjectSchema),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t('projects.create')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects.create')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            const r = await create({
              ...v,
              description: v.description || undefined,
              repositoryUrl: v.repositoryUrl || undefined,
            });
            if (!('error' in r)) {
              setOpen(false);
              form.reset();
            }
          })}
        >
          <Field
            id="p-key"
            label={t('projects.key')}
            hint={t('projects.keyHint')}
            error={form.formState.errors.key?.message}
          >
            <Input
              id="p-key"
              placeholder="QSNET"
              {...form.register('key', { setValueAs: (v: string) => v.toUpperCase() })}
            />
          </Field>
          <Field id="p-name" label={t('projects.name')} error={form.formState.errors.name?.message}>
            <Input id="p-name" {...form.register('name')} />
          </Field>
          <Field id="p-desc" label={t('projects.description')}>
            <Input id="p-desc" {...form.register('description')} />
          </Field>
          <ErrorText error={res.error} />
          <Button type="submit" disabled={res.isLoading}>
            {t('common.create')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Cài đặt dự án: /p/:key/settings ----
export function ProjectSettingsPage() {
  const { t } = useTranslation();
  const { key } = useParams();
  const q = useProjectsQuery();
  const archivedQ = useProjectsQuery({ archived: true });
  const project = [...(q.data?.data ?? []), ...(archivedQ.data?.data ?? [])].find(
    (p) => p.key === key,
  );
  const [tab, setTab] = useState<'environments' | 'members'>('environments');
  if (q.isLoading || archivedQ.isLoading)
    return <div className="bg-muted h-8 w-48 animate-pulse rounded" />;
  if (!project) return <Navigate to="/projects" replace />;
  return (
    <div>
      <PageHeader
        title={`${project.name} · ${t('projects.settings')}`}
        description={project.key}
        actions={<ArchiveButton project={project} />}
      />
      <div role="tablist" className="mb-6 flex gap-1 border-b">
        {(['environments', 'members'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k ? 'border-primary font-medium' : 'text-muted-foreground border-transparent',
            )}
          >
            {t(`projects.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'environments' ? (
        <EnvironmentsTab projectId={project.id} />
      ) : (
        <MembersTab projectId={project.id} />
      )}
    </div>
  );
}

function ArchiveButton({ project }: { project: Project }) {
  const { t } = useTranslation();
  const canArchive = useCan('project.archive', project.id);
  const [archive] = useArchiveProjectMutation();
  if (!canArchive) return null;
  const archived = !!project.archivedAt;
  return (
    <Button
      variant="outline"
      onClick={() =>
        (archived || confirm(t('projects.archiveConfirm'))) &&
        void archive({ id: project.id, archived: !archived })
      }
    >
      {archived ? t('projects.unarchive') : t('projects.archive')}
    </Button>
  );
}

// ---- Môi trường ----
function EnvironmentsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const q = useEnvironmentsQuery(projectId);
  const canManage = useCan('project.environments.manage', projectId);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {canManage && <CreateEnvironmentForm projectId={projectId} />}
      <QueryState query={q} empty={{ when: (d) => !d.data.length, text: t('env.empty') }}>
        {(d) => (
          <div className="space-y-3">
            {d.data.map((e) => (
              <EnvironmentCard
                key={e.id}
                env={e}
                expanded={selected === e.id}
                onToggle={() => setSelected(selected === e.id ? null : e.id)}
              />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function CreateEnvironmentForm({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [create, res] = useCreateEnvironmentMutation();
  const canProd = useCan('project.environments.production', projectId);
  const form = useForm<z.input<typeof createEnvironmentSchema>>({
    resolver: zodResolver(createEnvironmentSchema),
    defaultValues: { kind: 'LOCAL', webBaseUrl: 'http://localhost:3000' },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('env.create')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-4 md:items-end"
          onSubmit={form.handleSubmit(async (v) => {
            const r = await create({
              projectId,
              ...v,
              webBaseUrl: v.webBaseUrl || undefined,
              apiBaseUrl: v.apiBaseUrl || undefined,
            });
            if (!('error' in r))
              form.reset({ kind: v.kind, name: '', webBaseUrl: '', apiBaseUrl: '' });
          })}
        >
          <Field id="e-name" label={t('env.name')} error={form.formState.errors.name?.message}>
            <Input id="e-name" placeholder="Local" {...form.register('name')} />
          </Field>
          <Field id="e-kind" label={t('env.kind')}>
            <NativeSelect id="e-kind" {...form.register('kind')}>
              {ENVIRONMENT_KINDS.filter((k) => canProd || k !== 'PRODUCTION').map((k) => (
                <option key={k} value={k}>
                  {t(`enum.env.${k}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="e-web"
            label={t('env.webBaseUrl')}
            error={form.formState.errors.webBaseUrl?.message}
          >
            <Input
              id="e-web"
              placeholder="http://localhost:3000"
              {...form.register('webBaseUrl')}
            />
          </Field>
          <Field
            id="e-api"
            label={t('env.apiBaseUrl')}
            error={form.formState.errors.apiBaseUrl?.message}
          >
            <Input
              id="e-api"
              placeholder="http://localhost:5000"
              {...form.register('apiBaseUrl')}
            />
          </Field>
          <div className="md:col-span-4">
            <ErrorText error={res.error} />
            <Button type="submit" className="mt-2" disabled={res.isLoading}>
              {t('common.create')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EnvironmentCard({
  env,
  expanded,
  onToggle,
}: {
  env: Environment;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const canToggle = useCan(
    env.kind === 'PRODUCTION'
      ? 'project.environments.production'
      : 'project.environments.testingToggle',
    env.projectId,
  );
  const canDelete = useCan('project.environments.delete', env.projectId);
  const [toggle, res] = useToggleTestingMutation();
  const [del] = useDeleteEnvironmentMutation();
  const [pending, setPending] = useState<boolean | null>(null);
  const lockedByOrg = env.testingBlock?.blockedBy === 'ORGANIZATION';
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-medium">{env.name}</span>
            <EnvBadge kind={env.kind} paused={!!env.testingBlock} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={env.testingEnabled}
                disabled={!canToggle || lockedByOrg}
                onCheckedChange={(v) => setPending(v)}
                aria-label={t('env.testingEnabled')}
              />
              {t('env.testingEnabled')}
            </label>
            <Button size="sm" variant="outline" onClick={onToggle} aria-expanded={expanded}>
              {expanded ? t('common.collapse') : t('env.details')}
            </Button>
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  confirm(t('env.deleteConfirm', { name: env.name })) && void del(env.id)
                }
              >
                {t('common.remove')}
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          {[env.webBaseUrl, env.apiBaseUrl].filter(Boolean).join(' · ') || t('env.noUrl')}
        </p>
        {env.testingBlock && (
          <p
            role="status"
            className="border-status-warn/50 text-status-warn rounded-md border px-3 py-2 text-sm"
          >
            {lockedByOrg
              ? t('env.lockedByOrg')
              : `${env.testingBlock.message}${env.testingBlock.reason ? `: ${env.testingBlock.reason}` : ''}`}
          </p>
        )}
        {expanded && (
          <div className="grid gap-4 pt-2 lg:grid-cols-2">
            <VariablesEditor env={env} />
            <CredentialsEditor env={env} />
          </div>
        )}
      </CardContent>
      <ReasonDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={t(pending ? 'testing.enableTitle' : 'testing.disableTitle', { name: env.name })}
        warning={pending && env.kind === 'PRODUCTION' ? t('testing.productionWarning') : undefined}
        confirmWord={pending && env.kind === 'PRODUCTION' ? env.name : undefined}
        confirmLabel={pending ? t('testing.enable') : t('testing.disable')}
        error={res.error}
        busy={res.isLoading}
        onConfirm={async (reason) => {
          const r = await toggle({ id: env.id, enabled: !!pending, reason });
          if (!('error' in r)) setPending(null);
        }}
      />
    </Card>
  );
}

function VariablesEditor({ env }: { env: Environment }) {
  const { t } = useTranslation();
  const q = useVariablesQuery(env.id);
  const secrets = useSecretsQuery(env.projectId, {
    skip: !useCan('project.secrets.read', env.projectId),
  });
  const canManage = useCan('project.environments.manage', env.projectId);
  const [save, res] = useSaveVariablesMutation();
  const [draft, setDraft] = useState<Variable[] | null>(null);
  const rows = draft ?? q.data?.data ?? [];
  const set = (i: number, v: Variable) => setDraft(rows.map((r, j) => (j === i ? v : r)));
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t('env.variables')}</h3>
      <QueryState query={q}>
        {() => (
          <div className="space-y-2">
            {rows.map((v, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label={t('env.varKey')}
                  value={v.key}
                  disabled={!canManage}
                  onChange={(e) => set(i, { ...v, key: e.target.value })}
                  className="w-1/3"
                />
                {v.secretId !== undefined ? (
                  <NativeSelect
                    aria-label={t('env.varSecret')}
                    value={v.secretId}
                    disabled={!canManage}
                    onChange={(e) => set(i, { key: v.key, secretId: e.target.value })}
                  >
                    <option value="">{t('env.chooseSecret')}</option>
                    {secrets.data?.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        🔒 {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    aria-label={t('env.varValue')}
                    value={v.value ?? ''}
                    disabled={!canManage}
                    onChange={(e) => set(i, { key: v.key, value: e.target.value })}
                  />
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft(rows.filter((_, j) => j !== i))}
                    aria-label={t('common.remove')}
                  >
                    ✕
                  </Button>
                )}
              </div>
            ))}
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft([...rows, { key: '', value: '' }])}
                >
                  {t('env.addVar')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft([...rows, { key: '', secretId: '' }])}
                >
                  {t('env.addSecretVar')}
                </Button>
                {draft && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      const vars = draft.map((v) =>
                        v.secretId !== undefined
                          ? { key: v.key, secretId: v.secretId }
                          : { key: v.key, value: v.value ?? '' },
                      );
                      const r = await save({ id: env.id, vars });
                      if (!('error' in r)) {
                        setDraft(null);
                        toast.success(t('common.saved'));
                      }
                    }}
                  >
                    {t('common.save')}
                  </Button>
                )}
              </div>
            )}
            <ErrorText error={res.error} />
          </div>
        )}
      </QueryState>
    </section>
  );
}

function CredentialsEditor({ env }: { env: Environment }) {
  const { t } = useTranslation();
  const q = useCredentialsQuery(env.id);
  const canManage = useCan('project.environments.manage', env.projectId);
  const [create, res] = useCreateCredentialMutation();
  const [del] = useDeleteCredentialMutation();
  const form = useForm<z.input<typeof createCredentialSchema>>({
    resolver: zodResolver(createCredentialSchema),
  });
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t('env.credentials')}</h3>
      <QueryState query={q} empty={{ when: (d) => !d.data.length, text: t('env.noCredentials') }}>
        {(d) => (
          <ul className="space-y-1 text-sm">
            {d.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span>
                  <code>{c.roleName}</code> · {c.username} · ••••
                </span>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void del({ envId: env.id, id: c.id })}
                  >
                    {t('common.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {canManage && (
        <form
          className="grid gap-2 sm:grid-cols-4"
          onSubmit={form.handleSubmit(async (v) => {
            const r = await create({ envId: env.id, ...v });
            if (!('error' in r)) form.reset();
          })}
        >
          <Input
            aria-label={t('env.roleName')}
            placeholder="admin"
            {...form.register('roleName')}
          />
          <Input
            aria-label={t('auth.email')}
            placeholder="admin@shop.vn"
            {...form.register('username')}
          />
          <Input
            aria-label={t('auth.password')}
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
          />
          <Button type="submit" size="sm">
            {t('common.add')}
          </Button>
          <div className="sm:col-span-4">
            <ErrorText error={res.error} />
            {(
              form.formState.errors.roleName ??
              form.formState.errors.username ??
              form.formState.errors.password
            )?.message && (
              <p className="text-status-error text-xs">
                {
                  (
                    form.formState.errors.roleName ??
                    form.formState.errors.username ??
                    form.formState.errors.password
                  )?.message
                }
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

// ---- Thành viên dự án ----
function MembersTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const org = useCurrentOrg()!;
  const q = useProjectMembersQuery(projectId);
  const orgMembers = useMembersQuery(org.id);
  const canManage = useCan('project.members.manage', projectId);
  const [add, addRes] = useAddProjectMemberMutation();
  const [update] = useUpdateProjectMemberMutation();
  const [remove] = useRemoveProjectMemberMutation();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('TESTER');
  const inProject = new Set(q.data?.data.map((m) => m.userId));
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <Field id="pm-user" label={t('projects.addMember')}>
            <NativeSelect
              id="pm-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-64"
            >
              <option value="">–</option>
              {orgMembers.data?.data
                .filter((m) => !inProject.has(m.userId) && m.role !== 'OWNER' && m.role !== 'ADMIN')
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName} ({m.email})
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field id="pm-role" label={t('settings.role')}>
            <NativeSelect
              id="pm-role"
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectRole)}
              className="w-40"
            >
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`enum.role.${r}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            disabled={!userId}
            onClick={async () => {
              const r = await add({ projectId, userId, role });
              if (!('error' in r)) setUserId('');
            }}
          >
            {t('common.add')}
          </Button>
          <ErrorText error={addRes.error} />
        </div>
      )}
      <p className="text-muted-foreground text-sm">{t('projects.adminsSeeAll')}</p>
      <QueryState query={q} empty={{ when: (d) => !d.data.length, text: t('projects.noMembers') }}>
        {(d) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('auth.displayName')}</TableHead>
                <TableHead>{t('auth.email')}</TableHead>
                <TableHead>{t('settings.role')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.data.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>{m.displayName}</TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={t('settings.role')}
                      value={m.role}
                      disabled={!canManage}
                      className="w-40"
                      onChange={(e) =>
                        void update({
                          projectId,
                          userId: m.userId,
                          role: e.target.value as ProjectRole,
                        })
                      }
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`enum.role.${r}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void remove({ projectId, userId: m.userId })}
                      >
                        {t('common.remove')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryState>
    </div>
  );
}
