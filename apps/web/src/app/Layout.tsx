import { LayoutDashboard, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { LANGUAGES } from '@/i18n';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const NAV = [{ to: '/', key: 'nav.overview', icon: LayoutDashboard }] as const;

export function Layout() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(readTheme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-border flex shrink-0 flex-col border-b md:w-60 md:border-r md:border-b-0">
        <div className="px-4 py-4 text-lg font-semibold">{t('app.name')}</div>
        <nav className="flex gap-1 px-2 pb-2 md:flex-col">
          {NAV.map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                  isActive ? 'bg-muted font-medium' : 'hover:bg-muted',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 px-4 py-3">
          <label className="sr-only" htmlFor="lang">
            {t('language.label')}
          </label>
          <select
            id="lang"
            value={i18n.language}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            className="border-border bg-background rounded-md border px-2 py-1 text-sm"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
            className="hover:bg-muted rounded-md p-2"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
