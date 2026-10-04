import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, type AuthClient } from '@/features/auth/AuthProvider';
import type { DetailApi } from '@/features/detail/api';
import { DetailApiProvider } from '@/features/detail/DetailApiContext';
import { DetailPage } from '@/features/detail/DetailPage';
import type { PickupsApi } from '@/features/pickups/api';
import { PickupsApiProvider } from '@/features/pickups/PickupsApiContext';
import { PickupsPage } from '@/features/pickups/PickupsPage';
import { MapPage } from '@/features/map/MapPage';
import type { ReportsApi } from '@/features/map/reports';
import { ReportsApiProvider } from '@/features/map/ReportsApiContext';
import type { ReportSubmitApi } from '@/features/report/api';
import { OutboxProvider } from '@/features/report/outbox/OutboxProvider';
import { ReportPage } from '@/features/report/ReportPage';
import { ReportSubmitApiProvider } from '@/features/report/ReportSubmitApiContext';
import { AppLayout } from './AppLayout';
import { LandingPage, NotFoundPage, ProfilePage } from './pages';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<MapPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="reports/:id" element={<DetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="pickups" element={<PickupsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function App({
  authClient,
  reportsApi,
  submitApi,
  detailApi,
  pickupsApi,
}: {
  authClient?: AuthClient | null;
  reportsApi?: ReportsApi | null;
  submitApi?: ReportSubmitApi | null;
  detailApi?: DetailApi | null;
  pickupsApi?: PickupsApi | null;
}) {
  return (
    <AuthProvider client={authClient}>
      <ReportsApiProvider api={reportsApi}>
        <ReportSubmitApiProvider api={submitApi}>
          <OutboxProvider>
            <DetailApiProvider api={detailApi}>
              <PickupsApiProvider api={pickupsApi}>
                <BrowserRouter>
                  <AppRoutes />
                </BrowserRouter>
              </PickupsApiProvider>
            </DetailApiProvider>
          </OutboxProvider>
        </ReportSubmitApiProvider>
      </ReportsApiProvider>
    </AuthProvider>
  );
}
