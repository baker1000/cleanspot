import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, type AuthClient } from '@/features/auth/AuthProvider';
import { MapPage } from '@/features/map/MapPage';
import type { ReportsApi } from '@/features/map/reports';
import { ReportsApiProvider } from '@/features/map/ReportsApiContext';
import { AppLayout } from './AppLayout';
import { LandingPage, NotFoundPage, ProfilePage, ReportDetailPage, ReportPage } from './pages';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<MapPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function App({
  authClient,
  reportsApi,
}: {
  authClient?: AuthClient | null;
  reportsApi?: ReportsApi | null;
}) {
  return (
    <AuthProvider client={authClient}>
      <ReportsApiProvider api={reportsApi}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ReportsApiProvider>
    </AuthProvider>
  );
}
