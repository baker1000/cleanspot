import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useMatch } from 'react-router';
import { MapIcon, PlusIcon, UserIcon } from '@/components/icons';
import { LanguageSelect } from '@/components/LanguageSelect';
import { Alert } from '@/components/ui/Alert';
import { SkipLink } from '@/components/ui/SkipLink';
import { useAuth } from '@/features/auth/useAuth';
import { OutboxStatus } from '@/features/report/outbox/OutboxStatus';
import { OfflineNotice } from './OfflineNotice';

interface NavItem {
  to: string;
  labelKey: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/app', labelKey: 'nav.map', Icon: MapIcon, end: true },
  { to: '/app/report', labelKey: 'nav.report', Icon: PlusIcon },
  { to: '/app/profile', labelKey: 'nav.profile', Icon: UserIcon },
];

/** Mobile-first shell: header, main content, bottom navigation. */
export function AppLayout() {
  const { t } = useTranslation();
  const { status } = useAuth();
  // The map fills the space between header and bottom navigation edge to edge.
  const fullBleed = useMatch({ path: '/app', end: true }) !== null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink targetId="main">{t('nav.skipToContent')}</SkipLink>

      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <Link to="/" className="text-lg font-bold text-brand-900">
          {t('app.name')}
        </Link>
        <LanguageSelect />
      </header>

      {/* Reports waiting on this device (offline queue); visible on every app page. */}
      <div className="flex flex-col gap-2 px-4 pt-2 empty:hidden">
        <OfflineNotice />
        <OutboxStatus />
      </div>

      <main
        id="main"
        tabIndex={-1}
        className={
          fullBleed
            ? 'relative flex-1 focus:outline-none'
            : 'flex-1 px-4 py-4 pb-24 focus:outline-none'
        }
        style={
          fullBleed
            ? { marginBottom: 'calc(3.5rem + 1px + env(safe-area-inset-bottom))' }
            : undefined
        }
      >
        {/* The map page shows this warning in its own toolbar. */}
        {status === 'unconfigured' && !fullBleed && (
          <div className="mb-4">
            <Alert tone="warning">{t('errors.backendNotConfigured')}</Alert>
          </div>
        )}
        <Outlet />
      </main>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-xl">
          {NAV.map(({ to, labelKey, Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 text-sm ${isActive ? 'font-semibold text-brand-900' : 'text-slate-700'}`
                }
              >
                <Icon />
                {t(labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
