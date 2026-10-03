import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import type { AuthErrorKey } from './authErrors';
import { useAuth } from './useAuth';

const MIN_PASSWORD = 8;

export function AccountPanel() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  if (auth.isRegistered) {
    return (
      <section className="flex flex-col gap-3">
        <p>{t('auth.signedInAs', { email: auth.session?.user.email ?? '' })}</p>
        <Button variant="secondary" onClick={() => void auth.signOut()} className="self-start">
          {t('auth.signOut')}
        </Button>
      </section>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'signUp' && password.length < MIN_PASSWORD) {
      setError('weakPassword');
      return;
    }
    setBusy(true);
    const result =
      mode === 'signIn' ? await auth.signIn(email, password) : await auth.signUp(email, password);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else if (result.needsConfirmation) setCheckEmail(true);
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="text-slate-700">
        {auth.isAnonymous ? t('auth.anonymousSession') : t('auth.noSession')}
      </p>
      {mode === 'signUp' && <p className="text-slate-700">{t('auth.upgradeHint')}</p>}

      {checkEmail ? (
        <Alert tone="success">{t('auth.checkEmail')}</Alert>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <h2 className="text-xl font-semibold">
            {mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
          </h2>
          {error && <Alert tone="error">{t(`auth.errors.${error}`)}</Alert>}
          <TextField
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label={t('auth.password')}
            type="password"
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signUp' ? MIN_PASSWORD : undefined}
            hint={mode === 'signUp' ? t('auth.passwordHint') : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" loading={busy} block>
            {mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
          </Button>
        </form>
      )}

      <Button
        variant="ghost"
        onClick={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          setError(null);
          setCheckEmail(false);
        }}
      >
        {mode === 'signIn' ? t('auth.switchToSignUp') : t('auth.switchToSignIn')}
      </Button>
    </section>
  );
}
