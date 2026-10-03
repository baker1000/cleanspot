import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, string> = {
  info: 'border-sky-700 bg-sky-50 text-sky-950',
  success: 'border-brand-700 bg-brand-50 text-brand-900',
  warning: 'border-amber-700 bg-amber-50 text-amber-950',
  error: 'border-red-700 bg-red-50 text-red-950',
};

/** Errors and warnings are announced immediately (role=alert), others politely (role=status). */
export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const role = tone === 'error' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div role={role} className={`rounded-lg border-s-4 p-3 ${TONES[tone]}`}>
      {children}
    </div>
  );
}
