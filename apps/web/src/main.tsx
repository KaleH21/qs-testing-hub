import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { Provider } from 'react-redux';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { Layout } from './app/Layout';
import { store } from './app/store';
import { LoginPage, RequireAuth, SetupPage } from './features/auth/pages';
import { OverviewPage } from './features/overview/OverviewPage';
import { ProjectSettingsPage, ProjectsPage } from './features/projects/pages';
import {
  AuditLogPage,
  MembersPage,
  OrganizationPage,
  ProfilePage,
  ServiceAccountsPage,
  TargetsPage,
  TestingSwitchesPage,
} from './features/settings/pages';
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

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'p/:key/settings', element: <ProjectSettingsPage /> },
          { path: 'settings/profile', element: <ProfilePage /> },
          { path: 'settings/organization', element: <OrganizationPage /> },
          { path: 'settings/members', element: <MembersPage /> },
          { path: 'settings/service-accounts', element: <ServiceAccountsPage /> },
          { path: 'settings/targets', element: <TargetsPage /> },
          { path: 'settings/testing-switches', element: <TestingSwitchesPage /> },
          { path: 'settings/audit-log', element: <AuditLogPage /> },
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
