import { Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/hooks/useAuth';
import { moduleRoutes } from '@/modules/registry';
import { ChangePasswordPage } from '@/pages/auth/ChangePassword';
import { LoginPage } from '@/pages/auth/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { MenuFallback } from '@/pages/MenuFallback';

function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          {moduleRoutes.map(({ path, element: Page }) => (
            <Route key={path} path={path} element={<Suspense fallback={<p className="text-ink-400">Loading…</p>}><Page /></Suspense>} />
          ))}
          <Route path="*" element={<MenuFallback />} />
        </Route>
      </Route>
    </Routes>
  );
}
