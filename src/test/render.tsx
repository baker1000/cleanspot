import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/App';
import { AuthProvider, type AuthClient } from '@/features/auth/AuthProvider';

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', authClient = null }: { route?: string; authClient?: AuthClient | null } = {},
) {
  return {
    user: userEvent.setup(),
    ...render(
      <AuthProvider client={authClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthProvider>,
    ),
  };
}

export const renderApp = (opts: { route?: string; authClient?: AuthClient | null } = {}) =>
  renderWithProviders(<AppRoutes />, opts);
