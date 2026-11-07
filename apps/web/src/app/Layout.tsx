import type { Action } from '@qah/validation';
import {
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Moon,
  Network,
  Power,
  ScrollText,
  Settings,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAppDispatch } from '@/app/store';
import { Toaster } from '@/components/ui/sonner';
import { baseApi, loggedOut } from '@/lib/api';
import { useLogoutMutation } from '@/features/api';
import { LANGUAGES } from '@/i18n';
import { useCan, useCurrentOrg } from '@/lib/session';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

type NavItem = { to: string; key: string; icon: typeof LayoutDashboard; action?: Action };

const MAIN: NavItem[] = [
  { to: '/', key: 'nav.overview', icon: LayoutDashboard },
  { to: '/projects', key: 'nav.projects', icon: FolderKanban },
];
const SETTINGS: NavItem[] = [
  { to: '/settings/organization', key: 'settings.organization', icon: Settings },
  { to: '/settings/members', key: 'settings.members', icon: Users },
  {
    to: '/settings/service-accounts',
    key: 'settings.serviceAccounts',
    icon: KeyRound,
    action: 'org.serviceAccounts',
  },
  { to: '/settings/targets', key: 'targets.title', icon: Network },
  { to: '/settings/testing-switches', key: 'testing.title', icon: Power },
  { to: '/settings/audit-log', key: 'audit.title', icon: ScrollText, action: 'org.audit.read' },
];

function NavItemLink({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const allowed = useCan(item.action ?? 'org.read');
  if (!allowed) return null; // ẩn theo quyền (docs/10 §3); backend vẫn kiểm
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
          isActive ? 'bg-muted font-medium' : 'hover:bg-muted',
        )
      }
    >
      <Icon className="size-4" aria-hidden />
      {t(item.key)}
    </NavLink>
  );
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const org = useCurrentOrg();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [logout] = useLogoutMutation();

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b md:w-60 md:border-r md:border-b-0">
        <div className="px-4 pt-4 text-lg font-semibold">{t('app.name')}</div>
        {org && <div className="text-muted-foreground px-4 pb-3 text-xs">{org.name}</div>}
        <nav className="flex flex-wrap gap-1 px-2 pb-2 md:flex-col" aria-label={t('nav.main')}>
          {MAIN.map((i) => (
            <NavItemLink key={i.to} item={i} />
          ))}
          <p className="text-muted-foreground mt-3 hidden px-3 text-xs uppercase md:block">
            {t('nav.settings')}
          </p>
          {SETTINGS.map((i) => (
            <NavItemLink key={i.to} item={i} />
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-1 border-t px-3 py-3">
          <NavLink
            to="/settings/profile"
            className="hover:bg-muted rounded-md p-2"
            aria-label={t('profile.title')}
          >
            <User className="size-4" />
          </NavLink>
          <label className="sr-only" htmlFor="lang">
            {t('language.label')}
          </label>
          <select
            id="lang"
            value={i18n.language}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            className="bg-background rounded-md border px-2 py-1 text-sm"
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
          <button
            type="button"
            aria-label={t('auth.logout')}
            className="hover:bg-muted rounded-md p-2"
            onClick={async () => {
              await logout();
              dispatch(loggedOut());
              dispatch(baseApi.util.resetApiState());
              navigate('/login', { replace: true });
            }}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
      <Toaster richColors />
    </div>
  );
}
