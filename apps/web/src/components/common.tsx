import type { EnvironmentKind } from '@qah/validation';
import { AlertTriangle, Code, FlaskConical, Globe, Inbox, Laptop, PauseCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/** Lỗi đọc được + requestId + nút thử lại (docs/10 U4) */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const e = apiError(error);
  return (
    <div
      role="alert"
      className="border-status-error/40 text-status-error flex items-start gap-3 rounded-lg border p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">
        <p>{e?.message ?? t('common.error')}</p>
        {e?.requestId && (
          <p className="text-muted-foreground mt-1 text-xs">requestId: {e.requestId}</p>
        )}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const e = apiError(error);
  if (!error) return null;
  const details = e?.details?.map((d) => d.message ?? d.howToFix).filter(Boolean);
  return (
    <p role="alert" className="text-status-error text-sm">
      {e?.message ?? String(error)}
      {details?.length ? `: ${details.join('; ')}` : ''}
    </p>
  );
}

/** Skeleton / lỗi / rỗng dùng chung cho mọi query (docs/10 §7 QueryState) */
export function QueryState<T>({
  query,
  empty,
  children,
}: {
  query: { data?: T; isLoading: boolean; error?: unknown; refetch: () => unknown };
  empty?: { when: (d: T) => boolean; text: string; action?: ReactNode };
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted h-10 animate-pulse rounded-md" />
        ))}
      </div>
    );
  }
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data) return null;
  if (empty?.when(query.data)) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-sm">
        <Inbox className="size-6" aria-hidden />
        <p>{empty.text}</p>
        {empty.action}
      </div>
    );
  }
  return <>{children(query.data)}</>;
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-status-error text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

const ENV_STYLE: Record<EnvironmentKind, { icon: typeof Laptop; cls: string }> = {
  LOCAL: { icon: Laptop, cls: 'text-env-local border-env-local/50' },
  DEV: { icon: Code, cls: 'text-env-dev border-env-dev/50' },
  STAGING: { icon: FlaskConical, cls: 'text-env-staging border-env-staging/50' },
  PRODUCTION: { icon: Globe, cls: 'text-env-prod border-env-prod border-2' },
};

/** Badge loại môi trường: icon + chữ, không chỉ màu (docs/10 §2.6) */
export function EnvBadge({ kind, paused }: { kind: EnvironmentKind; paused?: boolean }) {
  const { t } = useTranslation();
  const { icon: Icon, cls } = ENV_STYLE[kind];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className={cn('gap-1', cls)}>
        <Icon className="size-3" aria-hidden />
        {t(`enum.env.${kind}`)}
      </Badge>
      {paused && (
        <Badge variant="outline" className="text-status-warn border-status-warn/50 gap-1">
          <PauseCircle className="size-3" aria-hidden />
          {t('testing.paused')}
        </Badge>
      )}
    </span>
  );
}

/**
 * Hộp thoại bật/tắt có lý do bắt buộc ≥ 10 ký tự (docs/10 §5.10). Bật Production còn yêu cầu
 * gõ đúng tên môi trường để xác nhận.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  warning,
  confirmWord,
  confirmLabel,
  onConfirm,
  error,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  warning?: string;
  confirmWord?: string;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  error?: unknown;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const valid = reason.trim().length >= 10 && (!confirmWord || typed === confirmWord);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setReason('');
          setTyped('');
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {warning && <DialogDescription>{warning}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          <Field id="reason" label={t('testing.reason')} hint={t('testing.reasonHint')}>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {confirmWord && (
            <Field id="confirm" label={t('testing.typeToConfirm', { word: confirmWord })}>
              <Input id="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
          )}
          <ErrorText error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid || busy} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hiện bí mật một lần (token SA, mật khẩu tạm) */
export function OneTimeSecret({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <div className="border-status-warn/50 space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{label}</p>
      <code className="bg-muted block rounded px-2 py-1 text-sm break-all">{value}</code>
      <p className="text-muted-foreground text-xs">{t('common.shownOnce')}</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        {t('common.copy')}
      </Button>
    </div>
  );
}

export function formatDate(iso: string | null | undefined, locale: string) {
  return iso
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(iso))
    : '–';
}
