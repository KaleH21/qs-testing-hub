import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, setupSchema } from '@qah/validation';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useNavigate } from 'react-router';
import type { z } from 'zod';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { ErrorText, Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Laptop, Loader2, LockKeyhole, ServerCrash, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { Input } from '@/components/ui/input';
import {
  useLoginMutation,
  useMeQuery,
  useSetupMutation,
  useSetupStatusQuery,
} from '@/features/api';
import { refreshAccessToken, tokenReceived } from '@/lib/api';

/** Chặn route khi chưa đăng nhập; lần đầu tải trang thử refresh bằng cookie */
export function RequireAuth() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.session.accessToken);
  const [checked, setChecked] = useState(!!token);
  useEffect(() => {
    if (token) return;
    void refreshAccessToken().then((t) => {
      if (t) dispatch(tokenReceived(t));
      setChecked(true);
    });
  }, [token, dispatch]);
  const me = useMeQuery(undefined, { skip: !token });
  if (!checked || (token && me.isLoading))
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden />
      </div>
    );
  if (!token || me.error) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Bố cục 2 cột: giới thiệu sản phẩm bên trái (ẩn trên màn hẹp), form bên phải */
function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const points = [
    { icon: Laptop, text: t('auth.point1') },
    { icon: ShieldCheck, text: t('auth.point2') },
    { icon: LockKeyhole, text: t('auth.point3') },
  ];
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="bg-sidebar text-sidebar-foreground relative hidden flex-col justify-between border-r p-10 lg:flex">
        <BrandMark />
        <div className="max-w-md space-y-8">
          <p className="text-foreground text-2xl leading-snug font-semibold text-balance">
            {t('auth.tagline')}
          </p>
          <ul className="space-y-4">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-sm">
                <span className="bg-brand/10 text-brand flex size-8 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground text-xs">© QA Testing Hub</p>
      </section>
      <section className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <BrandMark />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-muted-foreground text-sm">{description}</p>}
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

/** Không hỏi được API "đã setup chưa" → báo rõ thay vì im lặng ở màn login */
function ApiDown({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="border-status-error/40 text-status-error flex items-start gap-3 rounded-lg border p-3 text-sm"
    >
      <ServerCrash className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="flex-1">{t('auth.apiDown')}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const status = useSetupStatusQuery();
  const [login, { error, isLoading }] = useLoginMutation();
  const form = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });
  if (status.data?.needsSetup) return <Navigate to="/setup" replace />;
  const onSubmit = form.handleSubmit(async (values) => {
    const res = await login(values);
    if ('data' in res && res.data) {
      dispatch(tokenReceived(res.data.accessToken));
      navigate('/', { replace: true });
    }
  });
  const errs = form.formState.errors;
  return (
    <AuthCard title={t('auth.loginTitle')}>
      {status.isError && <ApiDown onRetry={() => void status.refetch()} />}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="email" label={t('auth.email')} error={errs.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            {...form.register('email')}
          />
        </Field>
        <Field id="password" label={t('auth.password')} error={errs.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="animate-spin" aria-hidden />}
          {t('auth.login')}
        </Button>
        {status.data?.deploymentMode === 'personal' && (
          <p className="text-muted-foreground text-xs">
            {t('auth.forgotPersonal')} <code>pnpm hub:reset-password --email …</code>
          </p>
        )}
      </form>
    </AuthCard>
  );
}

/** Lần chạy đầu (D-32): tạo Owner + tổ chức; chỉ hiện khi DB chưa có user */
export function SetupPage() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const status = useSetupStatusQuery();
  const [setup, { error, isLoading }] = useSetupMutation();
  const form = useForm<z.input<typeof setupSchema>, unknown, z.output<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
  });
  if (status.data && !status.data.needsSetup) return <Navigate to="/login" replace />;
  const onSubmit = form.handleSubmit(async (values) => {
    const res = await setup(values);
    if ('data' in res && res.data) {
      dispatch(tokenReceived(res.data.accessToken));
      navigate('/', { replace: true });
    }
  });
  const errs = form.formState.errors;
  return (
    <AuthCard title={t('auth.setupTitle')} description={t('auth.setupDescription')}>
      {status.isError && <ApiDown onRetry={() => void status.refetch()} />}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          id="organizationName"
          label={t('auth.organizationName')}
          error={errs.organizationName?.message}
        >
          <Input id="organizationName" autoFocus {...form.register('organizationName')} />
        </Field>
        <Field id="displayName" label={t('auth.displayName')} error={errs.displayName?.message}>
          <Input id="displayName" autoComplete="name" {...form.register('displayName')} />
        </Field>
        <Field id="email" label={t('auth.email')} error={errs.email?.message}>
          <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
        </Field>
        <Field
          id="password"
          label={t('auth.password')}
          hint={t('auth.passwordHint')}
          error={errs.password?.message}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="animate-spin" aria-hidden />}
          {t('auth.createOwner')}
        </Button>
      </form>
    </AuthCard>
  );
}
