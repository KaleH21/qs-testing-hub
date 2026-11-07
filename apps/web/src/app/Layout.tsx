import type { Action } from '@qah/validation';
import {
  ChevronsUpDown,
  FolderKanban,
  Globe2,
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
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAppDispatch } from '@/app/store';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { BrandMark } from '@/components/brand';
import { Toaster } from '@/components/ui/sonner';
import { useLogoutMutation, useMeQuery } from '@/features/api';
import { baseApi, loggedOut } from '@/lib/api';
import { useCan, useCurrentOrg } from '@/lib/session';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';

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
const ALL = [...MAIN, ...SETTINGS, { to: '/settings/profile', key: 'profile.title', icon: User }];

function NavEntry({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const allowed = useCan(item.action ?? 'org.read');
  if (!allowed) return null; // ẩn theo quyền (docs/10 §3); backend vẫn kiểm
  const active =
    item.to === '/'
      ? pathname === '/'
      : pathname.startsWith(item.to) || (item.to === '/projects' && pathname.startsWith('/p/'));
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={t(item.key)}>
        <NavLink to={item.to} end={item.to === '/'}>
          <Icon aria-hidden />
          <span>{t(item.key)}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

function UserMenu() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMeQuery();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [logout] = useLogoutMutation();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };
  if (!me) return null;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
              aria-label={t('nav.account')}
            >
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="bg-primary text-primary-foreground rounded-md text-xs font-semibold">
                  {initials(me.user.displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{me.user.displayName}</span>
                <span className="text-muted-foreground truncate text-xs">{me.user.email}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              {me.user.email}
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/settings/profile">
                <User aria-hidden /> {t('profile.title')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                toggleTheme();
              }}
            >
              {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
              {theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void i18n.changeLanguage(i18n.language === 'vi' ? 'en' : 'vi');
              }}
            >
              <Globe2 aria-hidden />
              {i18n.language === 'vi' ? 'English' : 'Tiếng Việt'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                await logout();
                dispatch(loggedOut());
                dispatch(baseApi.util.resetApiState());
                navigate('/login', { replace: true });
              }}
            >
              <LogOut aria-hidden /> {t('auth.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function Layout() {
  const { t } = useTranslation();
  const org = useCurrentOrg();
  const { pathname } = useLocation();
  const current = [...ALL]
    .sort((a, b) => b.to.length - a.to.length)
    .find((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)));
  const title = pathname.startsWith('/p/') ? t('projects.settings') : current ? t(current.key) : '';

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-14 justify-center border-b px-3">
          <BrandMark subtitle={org?.name} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {MAIN.map((i) => (
                  <NavEntry key={i.to} item={i} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t('nav.settings')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {SETTINGS.map((i) => (
                  <NavEntry key={i.to} item={i} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          <UserMenu />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="bg-background/90 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label={t('nav.toggleSidebar')} />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <span className="text-muted-foreground truncate text-sm">{title}</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </SidebarInset>
      <Toaster richColors closeButton position="bottom-right" />
    </SidebarProvider>
  );
}
