export type AuthErrorKey =
  'invalidCredentials' | 'weakPassword' | 'emailTaken' | 'rateLimited' | 'network' | 'unknown';

interface ErrorLike {
  name?: string;
  code?: string;
  status?: number;
}

/** Maps a Supabase Auth error to a translation key under `auth.errors`. */
export function mapAuthError(error: ErrorLike | null | undefined): AuthErrorKey {
  if (!error) return 'unknown';
  switch (error.code) {
    case 'invalid_credentials':
      return 'invalidCredentials';
    case 'weak_password':
      return 'weakPassword';
    case 'user_already_exists':
    case 'email_exists':
      return 'emailTaken';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rateLimited';
  }
  if (error.status === 429) return 'rateLimited';
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return 'network';
  return 'unknown';
}
