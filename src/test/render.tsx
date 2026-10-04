import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/App';
import { AuthProvider, type AuthClient } from '@/features/auth/AuthProvider';
import type { ReportsApi } from '@/features/map/reports';
import { ReportsApiProvider } from '@/features/map/ReportsApiContext';

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', authClient = null, reportsApi = null }: RenderOptions = {},
) {
  return {
    user: userEvent.setup(),
    ...render(
      <AuthProvider client={authClient}>
        <ReportsApiProvider api={reportsApi}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </ReportsApiProvider>
      </AuthProvider>,
    ),
  };
}

export interface RenderOptions {
  route?: string;
  authClient?: AuthClient | null;
  reportsApi?: ReportsApi | null;
}

export const renderApp = (opts: RenderOptions = {}) => renderWithProviders(<AppRoutes />, opts);
