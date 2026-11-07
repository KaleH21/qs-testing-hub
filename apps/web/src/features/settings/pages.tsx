import { zodResolver } from '@hookform/resolvers/zod';
import {
  addMemberSchema,
  changePasswordSchema,
  createTargetSchema,
  ORG_ROLES,
  SERVICE_ACCOUNT_SCOPES,
  VERIFICATION_METHODS,
  type OrgRole,
} from '@qah/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { useAppSelector } from '@/app/store';
import {
  ErrorText,
  Field,
  formatDate,
  OneTimeSecret,
  PageHeader,
  QueryState,
  ReasonDialog,
} from '@/components/common';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useAddMemberMutation,
  useApproveTargetMutation,
  useAuditLogsQuery,
  useChangePasswordMutation,
  useCreateServiceAccountMutation,
  useCreateTargetMutation,
  useDeleteTargetMutation,
  useLocalNetworkMutation,
  useMembersQuery,
  useMeQuery,
  useOrganizationQuery,
  useRemoveMemberMutation,
  useRevokeServiceAccountMutation,
  useRotateServiceAccountMutation,
  useServiceAccountsQuery,
  useTargetsQuery,
  useTestingSwitchesMutation,
  useUpdateMemberMutation,
  useUpdateMeMutation,
  useUpdateOrganizationMutation,
  useVerifyTargetMutation,
} from '@/features/api';
import { useCan, useCurrentOrg } from '@/lib/session';

const done = (t: (k: string) => string) => toast.success(t('common.saved'));

// ---- Hồ sơ cá nhân ----
export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const me = useMeQuery();
  const [updateMe, update] = useUpdateMeMutation();
  const [changePassword, pw] = useChangePasswordMutation();
  const pwForm = useForm<z.input<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
  });
  return (
    <div className="max-w-xl space-y-6">
      <PageHeader title={t('profile.title')} />
      <QueryState query={me}>
        {(data) => (
          <Card>
            <CardContent className="space-y-4 pt-6">
              <Field id="displayName" label={t('auth.displayName')}>
                <Input
                  id="displayName"
                  defaultValue={data.user.displayName}
                  onBlur={(e) =>
                    e.target.value !== data.user.displayName &&
                    updateMe({ displayName: e.target.value }).then(() => done(t))
                  }
                />
              </Field>
              <Field id="locale" label={t('language.label')}>
                <NativeSelect
                  id="locale"
                  defaultValue={data.user.locale}
                  onChange={(e) => {
                    void i18n.changeLanguage(e.target.value);
                    void updateMe({ locale: e.target.value }).then(() => done(t));
                  }}
                >
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                </NativeSelect>
              </Field>
              <Field id="timezone" label={t('profile.timezone')} hint="Asia/Ho_Chi_Minh">
                <Input
                  id="timezone"
                  defaultValue={data.user.timezone}
                  onBlur={(e) =>
                    e.target.value !== data.user.timezone &&
                    updateMe({ timezone: e.target.value }).then(() => done(t))
                  }
                />
              </Field>
              <ErrorText error={update.error} />
            </CardContent>
          </Card>
        )}
      </QueryState>
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.changePassword')}</CardTitle>
          <CardDescription>{t('profile.changePasswordHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={pwForm.handleSubmit(async (v) => {
              const r = await changePassword(v);
              if (!('error' in r)) {
                pwForm.reset();
                done(t);
              }
            })}
          >
            <Field
              id="currentPassword"
              label={t('profile.currentPassword')}
              error={pwForm.formState.errors.currentPassword?.message}
            >
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                {...pwForm.register('currentPassword')}
              />
            </Field>
            <Field
              id="newPassword"
              label={t('profile.newPassword')}
              hint={t('auth.passwordHint')}
              error={pwForm.formState.errors.newPassword?.message}
            >
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                {...pwForm.register('newPassword')}
              />
            </Field>
            <ErrorText error={pw.error} />
            <Button type="submit" disabled={pw.isLoading}>
              {t('common.save')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Tổ chức ----
export function OrganizationPage() {
  const { t } = useTranslation();
  const org = useCurrentOrg();
  const q = useOrganizationQuery(org!.id);
  const [update, res] = useUpdateOrganizationMutation();
  const canEdit = useCan('org.update');
  return (
    <div className="max-w-xl">
      <PageHeader title={t('settings.organization')} />
      <QueryState query={q}>
        {(o) => (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void update({ id: o.id, name: f.get('name'), defaultTimezone: f.get('tz') }).then(
                (r) => !('error' in r) && done(t),
              );
            }}
          >
            <Field id="name" label={t('settings.orgName')}>
              <Input id="name" name="name" defaultValue={o.name} disabled={!canEdit} />
            </Field>
            <Field id="tz" label={t('profile.timezone')}>
              <Input id="tz" name="tz" defaultValue={o.defaultTimezone} disabled={!canEdit} />
            </Field>
            <ErrorText error={res.error} />
            {canEdit && <Button type="submit">{t('common.save')}</Button>}
          </form>
        )}
      </QueryState>
    </div>
  );
}

// ---- Thành viên ----
export function MembersPage() {
  const { t } = useTranslation();
  const org = useCurrentOrg()!;
  const q = useMembersQuery(org.id);
  const canManage = useCan('org.members.manage');
  const [updateMember, upd] = useUpdateMemberMutation();
  const [removeMember, rm] = useRemoveMemberMutation();
  return (
    <div>
      <PageHeader
        title={t('settings.members')}
        description={t('settings.membersHint')}
        actions={canManage && <AddMemberDialog orgId={org.id} />}
      />
      <ErrorText error={upd.error ?? rm.error} />
      <QueryState query={q}>
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
                      onChange={(e) =>
                        void updateMember({
                          orgId: org.id,
                          userId: m.userId,
                          role: e.target.value as OrgRole,
                        })
                      }
                      className="w-40"
                    >
                      {ORG_ROLES.map((r) => (
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
                        onClick={() =>
                          confirm(t('settings.removeConfirm', { name: m.displayName })) &&
                          void removeMember({ orgId: org.id, userId: m.userId })
                        }
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

function AddMemberDialog({ orgId }: { orgId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [add, res] = useAddMemberMutation();
  const [temp, setTemp] = useState<string | null>(null);
  const form = useForm<z.input<typeof addMemberSchema>>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { role: 'TESTER' },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setTemp(null);
          form.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>{t('settings.addMember')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.addMember')}</DialogTitle>
        </DialogHeader>
        {temp ? (
          <OneTimeSecret label={t('settings.temporaryPassword')} value={temp} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              const r = await add({ orgId, ...v });
              if ('data' in r && r.data) {
                if (r.data.temporaryPassword) setTemp(r.data.temporaryPassword);
                else setOpen(false);
              }
            })}
          >
            <Field
              id="m-email"
              label={t('auth.email')}
              error={form.formState.errors.email?.message}
            >
              <Input id="m-email" type="email" {...form.register('email')} />
            </Field>
            <Field
              id="m-name"
              label={t('auth.displayName')}
              error={form.formState.errors.displayName?.message}
            >
              <Input id="m-name" {...form.register('displayName')} />
            </Field>
            <Field id="m-role" label={t('settings.role')}>
              <NativeSelect id="m-role" {...form.register('role')}>
                {ORG_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`enum.role.${r}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ErrorText error={res.error} />
            <Button type="submit" disabled={res.isLoading}>
              {t('common.add')}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Service account ----
export function ServiceAccountsPage() {
  const { t, i18n } = useTranslation();
  const q = useServiceAccountsQuery();
  const [create, cr] = useCreateServiceAccountMutation();
  const [rotate] = useRotateServiceAccountMutation();
  const [revoke] = useRevokeServiceAccountMutation();
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['runs:create', 'runs:read']);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('settings.serviceAccounts')}
        description={t('settings.serviceAccountsHint')}
      />
      {token && <OneTimeSecret label={t('settings.saToken')} value={token} />}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Field id="sa-name" label={t('settings.saName')}>
            <Input
              id="sa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="github-actions"
            />
          </Field>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-sm font-medium">{t('settings.scopes')}</legend>
            {SERVICE_ACCOUNT_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) =>
                    setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))
                  }
                />
                <code>{s}</code>
              </label>
            ))}
          </fieldset>
          <ErrorText error={cr.error} />
          <Button
            disabled={!name || !scopes.length}
            onClick={async () => {
              const r = await create({ name, scopes });
              if ('data' in r && r.data?.token) {
                setToken(r.data.token);
                setName('');
              }
            }}
          >
            {t('settings.createSa')}
          </Button>
        </CardContent>
      </Card>
      <QueryState query={q} empty={{ when: (d) => !d.data.length, text: t('settings.noSa') }}>
        {(d) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.saName')}</TableHead>
                <TableHead>{t('settings.scopes')}</TableHead>
                <TableHead>{t('settings.lastUsed')}</TableHead>
                <TableHead>{t('settings.expires')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.name}{' '}
                    <code className="text-muted-foreground text-xs">qah_{s.tokenPrefix}_…</code>
                    {s.revokedAt && (
                      <Badge variant="outline" className="ml-2">
                        {t('settings.revoked')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{s.scopes.join(', ')}</TableCell>
                  <TableCell>{formatDate(s.lastUsedAt, i18n.language)}</TableCell>
                  <TableCell>{formatDate(s.expiresAt, i18n.language)}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    {!s.revokedAt && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const r = await rotate(s.id);
                            if ('data' in r && r.data?.token) setToken(r.data.token);
                          }}
                        >
                          {t('settings.rotate')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => confirm(t('settings.revokeConfirm')) && void revoke(s.id)}
                        >
                          {t('settings.revoke')}
                        </Button>
                      </>
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

// ---- Allowlist + dải IP nội bộ ----
export function TargetsPage() {
  const { t, i18n } = useTranslation();
  const org = useCurrentOrg()!;
  const orgQ = useOrganizationQuery(org.id);
  const q = useTargetsQuery();
  const canManage = useCan('org.targets.manage');
  const [saveNet, net] = useLocalNetworkMutation();
  const [verify, ver] = useVerifyTargetMutation();
  const [approve, appr] = useApproveTargetMutation();
  const [del] = useDeleteTargetMutation();
  const [create, cr] = useCreateTargetMutation();
  const [approving, setApproving] = useState<number | null>(null);
  const form = useForm<z.input<typeof createTargetSchema>>({
    resolver: zodResolver(createTargetSchema),
    defaultValues: { verificationMethod: 'DNS_TXT' },
  });
  return (
    <div className="space-y-6">
      <PageHeader title={t('targets.title')} description={t('targets.hint')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('targets.localNetwork')}</CardTitle>
          <CardDescription>{t('targets.localNetworkHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState query={orgQ}>
            {(o) => (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const cidrs = String(f.get('cidrs') ?? '')
                    .split(/[\s,]+/)
                    .filter(Boolean);
                  void saveNet({
                    id: o.id,
                    allowedCidrs: cidrs,
                    allowLoopback: f.get('loopback') === 'on',
                  }).then((r) => !('error' in r) && done(t));
                }}
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="loopback"
                    defaultChecked={o.localNetwork.allowLoopback}
                    disabled={!canManage}
                  />
                  {t('targets.allowLoopback')}
                </label>
                <Field id="cidrs" label={t('targets.cidrs')} hint="192.168.1.0/24, 10.20.30.0/24">
                  <Input
                    id="cidrs"
                    name="cidrs"
                    defaultValue={o.localNetwork.allowedCidrs.join(', ')}
                    disabled={!canManage}
                  />
                </Field>
                <ErrorText error={net.error} />
                {canManage && <Button type="submit">{t('common.save')}</Button>}
              </form>
            )}
          </QueryState>
        </CardContent>
      </Card>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{t('targets.add')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end"
              onSubmit={form.handleSubmit(async (v) => {
                const r = await create(v);
                if (!('error' in r)) form.reset({ verificationMethod: v.verificationMethod });
              })}
            >
              <Field
                id="host"
                label={t('targets.host')}
                error={form.formState.errors.hostPattern?.message}
              >
                <Input
                  id="host"
                  placeholder="staging.example.vn"
                  {...form.register('hostPattern')}
                />
              </Field>
              <Field id="method" label={t('targets.method')}>
                <NativeSelect id="method" {...form.register('verificationMethod')}>
                  {VERIFICATION_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`enum.verification.${m}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Button type="submit">{t('common.add')}</Button>
            </form>
            <ErrorText error={cr.error} />
          </CardContent>
        </Card>
      )}
      <ErrorText error={ver.error} />
      <QueryState query={q} empty={{ when: (d) => !d.data.length, text: t('targets.empty') }}>
        {(d) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('targets.host')}</TableHead>
                <TableHead>{t('targets.method')}</TableHead>
                <TableHead>{t('targets.status')}</TableHead>
                <TableHead>{t('settings.expires')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.data.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    <div>{x.hostPattern}</div>
                    {x.status === 'PENDING' && x.instructions.dnsTxt && (
                      <code className="text-muted-foreground text-xs">
                        TXT {x.instructions.dnsTxt.name} = {x.instructions.dnsTxt.value}
                      </code>
                    )}
                    {x.status === 'PENDING' && x.instructions.file && (
                      <code className="text-muted-foreground block text-xs">
                        {x.instructions.file.url} → {x.instructions.file.content}
                      </code>
                    )}
                  </TableCell>
                  <TableCell>{t(`enum.verification.${x.verificationMethod}`)}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={x.status === 'VERIFIED' ? 'text-status-ok' : 'text-status-warn'}
                    >
                      {t(`targets.statusValue.${x.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(x.expiresAt, i18n.language)}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    {canManage &&
                      x.status !== 'VERIFIED' &&
                      x.verificationMethod !== 'ADMIN_APPROVAL' && (
                        <Button size="sm" variant="outline" onClick={() => void verify(x.id)}>
                          {t('targets.verify')}
                        </Button>
                      )}
                    {canManage &&
                      x.status !== 'VERIFIED' &&
                      x.verificationMethod === 'ADMIN_APPROVAL' && (
                        <Button size="sm" variant="outline" onClick={() => setApproving(x.id)}>
                          {t('targets.approve')}
                        </Button>
                      )}
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => confirm(t('targets.deleteConfirm')) && void del(x.id)}
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
      <ReasonDialog
        open={!!approving}
        onOpenChange={(o) => !o && setApproving(null)}
        title={t('targets.approve')}
        confirmLabel={t('targets.approve')}
        error={appr.error}
        busy={appr.isLoading}
        onConfirm={async (reason) => {
          const r = await approve({ id: approving!, reason });
          if (!('error' in r)) setApproving(null);
        }}
      />
    </div>
  );
}

// ---- Công tắc test cấp tổ chức (docs/10 §5.10) ----
export function TestingSwitchesPage() {
  const { t, i18n } = useTranslation();
  const org = useCurrentOrg()!;
  const q = useOrganizationQuery(org.id);
  const history = useAuditLogsQuery({ action: 'testing.switch' });
  const [toggle, res] = useTestingSwitchesMutation();
  const canManage = useCan('org.testingSwitches');
  const [pending, setPending] = useState<{
    key: 'productionTesting' | 'localTesting';
    value: boolean;
  } | null>(null);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={t('testing.title')} description={t('testing.hint')} />
      <QueryState query={q}>
        {(o) => (
          <Card>
            <CardContent className="divide-y pt-2">
              {(
                [
                  ['productionTesting', o.productionTestingEnabled],
                  ['localTesting', o.localTestingEnabled],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <Label htmlFor={key} className="text-base">
                      {t(`testing.${key}`)}
                    </Label>
                    <p className="text-muted-foreground text-sm">{t(`testing.${key}Hint`)}</p>
                  </div>
                  <Switch
                    id={key}
                    checked={value}
                    disabled={!canManage}
                    onCheckedChange={(v) => setPending({ key, value: v })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </QueryState>
      <ReasonDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={
          pending
            ? t(pending.value ? 'testing.enableTitle' : 'testing.disableTitle', {
                name: t(`testing.${pending.key}`),
              })
            : ''
        }
        warning={
          pending?.key === 'productionTesting' && pending.value
            ? t('testing.productionWarning')
            : undefined
        }
        confirmWord={
          pending?.key === 'productionTesting' && pending.value ? 'Production' : undefined
        }
        confirmLabel={pending?.value ? t('testing.enable') : t('testing.disable')}
        error={res.error}
        busy={res.isLoading}
        onConfirm={async (reason) => {
          const r = await toggle({ id: org.id, [pending!.key]: pending!.value, reason });
          if (!('error' in r)) setPending(null);
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('testing.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState
            query={history}
            empty={{ when: (d) => !d.data.length, text: t('testing.noHistory') }}
          >
            {(d) => (
              <ul className="space-y-2 text-sm">
                {d.data.map((e) => (
                  <li key={e.id}>
                    <span className="text-muted-foreground">
                      {formatDate(e.createdAt, i18n.language)}
                    </span>{' '}
                    {JSON.stringify((e.metadata as { after?: unknown }).after)} –{' '}
                    {String((e.metadata as { reason?: string }).reason ?? '')}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Audit log ----
export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const q = useAuditLogsQuery({ action: action || undefined, cursor: cursors[cursors.length - 1] });
  const canExport = useCan('org.audit.export');
  const token = useAppSelector((s) => s.session.accessToken);
  const org = useCurrentOrg()!;
  return (
    <div>
      <PageHeader
        title={t('audit.title')}
        actions={
          canExport && (
            <Button
              variant="outline"
              onClick={async () => {
                // tải kèm Authorization (link thường không gửi được access token trong bộ nhớ)
                const res = await fetch(
                  `/api/v1/audit-logs/export${action ? `?action=${encodeURIComponent(action)}` : ''}`,
                  {
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'X-Organization-Id': String(org.id),
                    },
                  },
                );
                if (!res.ok) return toast.error(t('common.error'));
                const url = URL.createObjectURL(await res.blob());
                Object.assign(document.createElement('a'), {
                  href: url,
                  download: 'audit-logs.csv',
                }).click();
                URL.revokeObjectURL(url);
              }}
            >
              {t('audit.export')}
            </Button>
          )
        }
      />
      <div className="mb-4 max-w-xs">
        <Field id="action" label={t('audit.filterAction')}>
          <Input
            id="action"
            placeholder="testing.switch"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setCursors([]);
            }}
          />
        </Field>
      </div>
      <QueryState query={q} empty={{ when: (d) => !d.data.length, text: t('audit.empty') }}>
        {(d) => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('audit.time')}</TableHead>
                  <TableHead>{t('audit.action')}</TableHead>
                  <TableHead>{t('audit.entity')}</TableHead>
                  <TableHead>{t('audit.details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(e.createdAt, i18n.language)}
                    </TableCell>
                    <TableCell>
                      <code>{e.action}</code>
                    </TableCell>
                    <TableCell className="text-xs">{e.entityType}</TableCell>
                    <TableCell
                      className="max-w-md truncate text-xs"
                      title={JSON.stringify(e.metadata)}
                    >
                      {JSON.stringify(e.metadata)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!cursors.length}
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                {t('common.prev')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!d.nextCursor}
                onClick={() => setCursors([...cursors, d.nextCursor!])}
              >
                {t('common.next')}
              </Button>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
