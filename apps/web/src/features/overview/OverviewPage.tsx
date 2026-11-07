import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  FolderKanban,
  Globe,
  Laptop,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMeQuery, useOrganizationQuery, useProjectsQuery } from '@/features/api';
import { useCurrentOrg } from '@/lib/session';
import { cn } from '@/lib/utils';

type Readiness = { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
type HealthState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; data: Readiness };

function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/health/ready', { signal: ctrl.signal })
      .then(async (res) => setState({ kind: 'ok', data: (await res.json()) as Readiness }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ kind: 'error' });
      });
    return () => ctrl.abort();
  }, []);
  return state;
}

/** Thẻ số liệu: nhãn, giá trị, icon; trạng thái luôn có chữ (không chỉ màu) */
function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: 'ok' | 'off';
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-center gap-4 px-4">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md',
            tone === 'ok'
              ? 'bg-status-ok/10 text-status-ok'
              : tone === 'off'
                ? 'bg-muted text-status-neutral'
                : 'bg-muted text-foreground',
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="truncate text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Step({
  done,
  title,
  hint,
  to,
}: {
  done: boolean;
  title: string;
  hint: string;
  to: string;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <Link
        to={to}
        className="hover:bg-muted group flex items-start gap-3 rounded-md p-3 transition-colors duration-150"
      >
        {done ? (
          <CheckCircle2
            className="text-status-ok mt-0.5 size-5 shrink-0"
            aria-label={t('overview.done')}
          />
        ) : (
          <Circle className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-sm font-medium',
              done && 'text-muted-foreground line-through',
            )}
          >
            {title}
          </span>
          <span className="text-muted-foreground block text-sm">{hint}</span>
        </span>
        <ArrowRight
          className="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </li>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const me = useMeQuery();
  const current = useCurrentOrg();
  const org = useOrganizationQuery(current?.id ?? 0, { skip: !current });
  const projects = useProjectsQuery();
  const health = useHealth();
  const projectCount = projects.data?.data.length;
  const switchValue = (v: boolean | undefined) =>
    v === undefined ? '–' : v ? t('overview.on') : t('overview.off');

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('overview.greeting', { name: me.data?.user.displayName ?? '' })}
        </h1>
        <p className="text-muted-foreground">{t('overview.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('overview.projects')} value={projectCount ?? '–'} icon={FolderKanban} />
        <Stat
          label={t('overview.local')}
          value={switchValue(org.data?.localTestingEnabled)}
          icon={Laptop}
          tone={org.data?.localTestingEnabled ? 'ok' : 'off'}
        />
        <Stat
          label={t('overview.production')}
          value={switchValue(org.data?.productionTestingEnabled)}
          icon={Globe}
          tone={org.data?.productionTestingEnabled ? 'ok' : 'off'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('overview.nextSteps')}</CardTitle>
          </CardHeader>
          <CardContent className="px-3">
            <ol className="space-y-1">
              <Step
                done={!!projectCount}
                title={t('overview.step1')}
                hint={t('overview.step1Hint')}
                to="/projects"
              />
              <Step
                done={false}
                title={t('overview.step2')}
                hint={t('overview.step2Hint')}
                to={
                  projects.data?.data[0] ? `/p/${projects.data.data[0].key}/settings` : '/projects'
                }
              />
              <Step
                done={false}
                title={t('overview.step3')}
                hint={t('overview.step3Hint')}
                to="/settings/testing-switches"
              />
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('overview.systemStatus')}</CardTitle>
          </CardHeader>
          <CardContent>
            {health.kind === 'loading' && (
              <ul className="space-y-3" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="bg-muted h-5 animate-pulse rounded" />
                ))}
              </ul>
            )}
            {health.kind === 'error' && (
              <p role="alert" className="text-status-error flex items-center gap-2 text-sm">
                <XCircle className="size-4" aria-hidden /> {t('overview.unreachable')}
              </p>
            )}
            {health.kind === 'ok' && (
              <ul className="divide-y text-sm" aria-live="polite">
                {Object.entries(health.data.checks).map(([name, c]) => (
                  <li key={name} className="flex items-center justify-between gap-3 py-2.5">
                    <span>{t(`overview.check.${name}`, { defaultValue: name })}</span>
                    <span
                      className={cn(
                        'flex items-center gap-1.5 font-medium',
                        c.ok ? 'text-status-ok' : 'text-status-warn',
                      )}
                      title={c.error}
                    >
                      {c.ok ? (
                        <CheckCircle2 className="size-4" aria-hidden />
                      ) : (
                        <CircleDashed className="size-4" aria-hidden />
                      )}
                      {c.ok ? t('overview.ready') : t('overview.notReady')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
