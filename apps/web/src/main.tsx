import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { Layout } from './app/Layout';
import { OverviewPage } from './features/overview/OverviewPage';
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
  {
    element: <Layout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
