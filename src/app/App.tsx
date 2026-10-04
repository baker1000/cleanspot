import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, type AuthClient } from '@/features/auth/AuthProvider';
import { MapPage } from '@/features/map/MapPage';
import type { ReportsApi } from '@/features/map/reports';
import { ReportsApiProvider } from '@/features/map/ReportsApiContext';
import type { ReportSubmitApi } from '@/features/report/api';
import { OutboxProvider } from '@/features/report/outbox/OutboxProvider';
import { ReportPage } from '@/features/report/ReportPage';
import { ReportSubmitApiProvider } from '@/features/report/ReportSubmitApiContext';
import { AppLayout } from './AppLayout';
import { LandingPage, NotFoundPage, ProfilePage, ReportDetailPage } from './pages';

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
  submitApi,
}: {
  authClient?: AuthClient | null;
  reportsApi?: ReportsApi | null;
  submitApi?: ReportSubmitApi | null;
}) {
  return (
    <AuthProvider client={authClient}>
      <ReportsApiProvider api={reportsApi}>
        <ReportSubmitApiProvider api={submitApi}>
          <OutboxProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </OutboxProvider>
        </ReportSubmitApiProvider>
      </ReportsApiProvider>
    </AuthProvider>
  );
}
