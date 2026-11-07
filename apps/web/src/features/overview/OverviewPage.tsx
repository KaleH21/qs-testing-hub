import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Readiness = { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; data: Readiness };

export function OverviewPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/health/ready', { signal: ctrl.signal })
      .then(async (res) => setState({ kind: 'ok', data: (await res.json()) as Readiness }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ kind: 'error' });
      });
    return () => ctrl.abort();
  }, []);

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('overview.title')}</h1>
      <section className="border-border rounded-lg border p-4">
        <h2 className="mb-3 font-medium">{t('overview.systemStatus')}</h2>
        {state.kind === 'loading' && (
          <p className="text-muted-foreground">{t('overview.checking')}</p>
        )}
        {state.kind === 'error' && <p className="text-status-error">{t('overview.unreachable')}</p>}
        {state.kind === 'ok' && (
          <>
            <p className={state.data.ready ? 'text-status-ok' : 'text-status-error'}>
              {state.data.ready ? t('overview.ready') : t('overview.notReady')}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(state.data.checks).map(([name, c]) => (
                <li key={name} className="flex items-center gap-2">
                  {c.ok ? (
                    <CheckCircle2 className="text-status-ok size-4" aria-hidden />
                  ) : (
                    <XCircle className="text-status-error size-4" aria-hidden />
                  )}
                  <span>{t(`overview.check.${name}`, { defaultValue: name })}</span>
                  {c.error && <span className="text-muted-foreground">({c.error})</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
