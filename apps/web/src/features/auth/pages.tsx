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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    return <div className="bg-muted m-6 h-8 w-48 animate-pulse rounded" aria-busy="true" />;
  if (!token || me.error) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
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
          {t('auth.createOwner')}
        </Button>
      </form>
    </AuthCard>
  );
}
