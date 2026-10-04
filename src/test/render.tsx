import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/App';
import { AuthProvider, type AuthClient } from '@/features/auth/AuthProvider';
import type { DetailApi } from '@/features/detail/api';
import { DetailApiProvider } from '@/features/detail/DetailApiContext';
import type { ReportsApi } from '@/features/map/reports';
import { ReportsApiProvider } from '@/features/map/ReportsApiContext';
import type { ReportSubmitApi } from '@/features/report/api';
import { OutboxProvider } from '@/features/report/outbox/OutboxProvider';
import { createMemoryStore, type OutboxStore } from '@/features/report/outbox/store';
import { ReportSubmitApiProvider } from '@/features/report/ReportSubmitApiContext';

export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    authClient = null,
    reportsApi = null,
    submitApi = null,
    outboxStore = createMemoryStore(),
    detailApi = null,
  }: RenderOptions = {},
) {
  return {
    user: userEvent.setup(),
    ...render(
      <AuthProvider client={authClient}>
        <ReportsApiProvider api={reportsApi}>
          <ReportSubmitApiProvider api={submitApi}>
            <OutboxProvider store={outboxStore}>
              <DetailApiProvider api={detailApi}>
                <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
              </DetailApiProvider>
            </OutboxProvider>
          </ReportSubmitApiProvider>
        </ReportsApiProvider>
      </AuthProvider>,
    ),
  };
}

export interface RenderOptions {
  route?: string;
  authClient?: AuthClient | null;
  reportsApi?: ReportsApi | null;
  submitApi?: ReportSubmitApi | null;
  /** Offline queue; a fresh in-memory store per render by default, `null` = no queue. */
  outboxStore?: OutboxStore | null;
  detailApi?: DetailApi | null;
}

export const renderApp = (opts: RenderOptions = {}) => renderWithProviders(<AppRoutes />, opts);
