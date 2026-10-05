import { createContext, useContext, useState, type ReactNode } from 'react';
import { parseDemoConfig } from '@/lib/env';
import accounts from '../../../supabase/demo/accounts.json';

export type DemoRole = (typeof accounts)[number]['role'];
export interface DemoAccount {
  role: DemoRole;
  email: string;
}
export const DEMO_ACCOUNTS: readonly DemoAccount[] = accounts;

/** null = demo mode off (the normal case). */
export type DemoConfig = { password: string } | null;

const DemoContext = createContext<DemoConfig>(null);

export function DemoProvider({
  config,
  children,
}: {
  /** Inject for tests. Omit to use the env configuration. */
  config?: DemoConfig;
  children: ReactNode;
}) {
  const [value] = useState(() =>
    config === undefined ? parseDemoConfig(import.meta.env) : config,
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export const useDemo = () => useContext(DemoContext);

/** The demo role of an e-mail address, or null for any other account. */
export const demoRoleOf = (email: string | undefined): DemoRole | null =>
  DEMO_ACCOUNTS.find((a) => a.email === email)?.role ?? null;
