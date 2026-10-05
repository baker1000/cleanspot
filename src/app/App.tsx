import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, type AuthClient } from '@/features/auth/AuthProvider';
import type { DetailApi } from '@/features/detail/api';
import { DetailApiProvider } from '@/features/detail/DetailApiContext';
import { DetailPage } from '@/features/detail/DetailPage';
import { DemoProvider } from '@/features/demo/DemoContext';
import type { PickupsApi } from '@/features/pickups/api';
import { PickupsApiProvider } from '@/features/pickups/PickupsApiContext';
import { PickupsPage } from '@/features/pickups/PickupsPage';
import { LandingProvider } from '@/features/landing/LandingContext';
import { LandingPage } from '@/features/landing/LandingPage';
import { LEGAL_ALIASES, LEGAL_PATHS, type LegalDoc } from '@/features/legal/config';
import { LegalPage } from '@/features/legal/LegalPage';
import { MapPage } from '@/features/map/MapPage';
import type { ReportsApi } from '@/features/map/reports';
import { ReportsApiProvider } from '@/features/map/ReportsApiContext';
import type { ProfileApi } from '@/features/profile/api';
import { ProfileApiProvider } from '@/features/profile/ProfileApiContext';
import { ProfilePage } from '@/features/profile/ProfilePage';
import type { ReportSubmitApi } from '@/features/report/api';
import { OutboxProvider } from '@/features/report/outbox/OutboxProvider';
import { ReportPage } from '@/features/report/ReportPage';
import { ReportSubmitApiProvider } from '@/features/report/ReportSubmitApiContext';
import { isNative } from '@/lib/native';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './pages';
import { UpdatePrompt } from './UpdatePrompt';

const LEGAL_DOCS = Object.keys(LEGAL_PATHS) as LegalDoc[];

export function AppRoutes({ native = isNative() }: { native?: boolean }) {
  return (
    <Routes>
      {/* The landing page is the website; the native app opens on the map. */}
      <Route path="/" element={native ? <Navigate to="/app" replace /> : <LandingPage />} />
      {LEGAL_DOCS.flatMap((doc) =>
        [LEGAL_PATHS[doc], LEGAL_ALIASES[doc]].map((path) => (
          <Route key={path} path={path} element={<LegalPage doc={doc} />} />
        )),
      )}
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
  profileApi,
}: {
  authClient?: AuthClient | null;
  reportsApi?: ReportsApi | null;
  submitApi?: ReportSubmitApi | null;
  detailApi?: DetailApi | null;
  pickupsApi?: PickupsApi | null;
  profileApi?: ProfileApi | null;
}) {
  return (
    <AuthProvider client={authClient}>
      <ReportsApiProvider api={reportsApi}>
        <ReportSubmitApiProvider api={submitApi}>
          <OutboxProvider>
            <DetailApiProvider api={detailApi}>
              <PickupsApiProvider api={pickupsApi}>
                <ProfileApiProvider api={profileApi}>
                  <LandingProvider>
                    <DemoProvider>
                      <BrowserRouter>
                        <AppRoutes />
                        <UpdatePrompt />
                        {/* Solid strip behind the system status bar (edge-to-edge native app;
                          zero height in browsers), so scrolled content never runs under it. */}
                        <div
                          aria-hidden="true"
                          className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[var(--safe-top)] bg-white"
                        />
                      </BrowserRouter>
                    </DemoProvider>
                  </LandingProvider>
                </ProfileApiProvider>
              </PickupsApiProvider>
            </DetailApiProvider>
          </OutboxProvider>
        </ReportSubmitApiProvider>
      </ReportsApiProvider>
    </AuthProvider>
  );
}
