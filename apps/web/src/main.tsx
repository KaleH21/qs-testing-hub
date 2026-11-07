import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { Provider } from 'react-redux';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { store } from './app/store';
import { LoginPage, RequireAuth, SetupPage } from './features/auth/pages';
import './i18n';
import './index.css';
import { applyTheme, readTheme } from './lib/theme';

applyTheme(readTheme());

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <Link to="/" className="text-primary underline">
        {t('notFound.back')}
      </Link>
    </div>
  );
}

// Trang sau đăng nhập tải theo route (docs/10 §7): màn login/setup nhẹ, không kéo theo sidebar và các trang cài đặt
const settings = () => import('./features/settings/pages');
const projects = () => import('./features/projects/pages');

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        lazy: async () => ({ Component: (await import('./app/Layout')).Layout }),
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('./features/overview/OverviewPage')).OverviewPage,
            }),
          },
          { path: 'projects', lazy: async () => ({ Component: (await projects()).ProjectsPage }) },
          {
            path: 'p/:key/settings',
            lazy: async () => ({ Component: (await projects()).ProjectSettingsPage }),
          },
          {
            path: 'settings/profile',
            lazy: async () => ({ Component: (await settings()).ProfilePage }),
          },
          {
            path: 'settings/organization',
            lazy: async () => ({ Component: (await settings()).OrganizationPage }),
          },
          {
            path: 'settings/members',
            lazy: async () => ({ Component: (await settings()).MembersPage }),
          },
          {
            path: 'settings/service-accounts',
            lazy: async () => ({ Component: (await settings()).ServiceAccountsPage }),
          },
          {
            path: 'settings/targets',
            lazy: async () => ({ Component: (await settings()).TargetsPage }),
          },
          {
            path: 'settings/testing-switches',
            lazy: async () => ({ Component: (await settings()).TestingSwitchesPage }),
          },
          {
            path: 'settings/audit-log',
            lazy: async () => ({ Component: (await settings()).AuditLogPage }),
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </StrictMode>,
);
