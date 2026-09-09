import { ErrorState } from '@/components/ui/states';

/**
 * The OAuth flow can only report failure by redirecting back with a reason
 * code (the person is mid-navigation, not mid-fetch). This maps each code
 * to a sentence a human can act on. Unknown codes get the generic line —
 * never echoed back raw, so the query string can't inject copy.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'Sign-in could not be completed. Please try again.',
  oauth_start_failed: 'Sign-in could not be started. Please try again.',
  oauth_provider_error: 'The provider reported an error. Please try again.',
  oauth_invalid_callback: 'The sign-in response was incomplete. Please try again.',
  oauth_state_mismatch: 'This sign-in attempt expired or was opened in a different browser. Please try again.',
  oauth_not_configured: 'This sign-in method is not configured on this deployment.',
  oauth_unknown_provider: 'Unknown sign-in provider.',
  oauth_no_email:
    'Your provider account has no verified email address to sign in with. Add one there, or sign up with email and password.',
  oauth_email_unverified:
    'An account already exists for this email, but the provider has not verified the address. Sign in with your password instead.',
};

export function AuthError({ code }: { code?: string }) {
  if (!code) {
    return null;
  }
  const message = OAUTH_ERROR_MESSAGES[code] ?? 'Sign-in could not be completed. Please try again.';
  return (
    <div className="mb-5">
      <ErrorState title="Could not sign in" description={message} />
    </div>
  );
}

/**
 * Shown when the Control API could not be asked which sign-in providers
 * exist.
 *
 * Without this the page is actively misleading. `OAuthButtons` renders
 * nothing for a provider that is not configured — correct, since a button
 * that cannot complete is worse than no button — but a *failed lookup* used
 * to collapse into that same "no providers" answer. The result was a login
 * page showing only email and password, indistinguishable from a
 * deployment that genuinely has OAuth switched off, with no clue that
 * "Continue with GitHub" was missing because nothing could be reached.
 *
 * The email form is no better off, it just fails later: signing in needs
 * the same API. So this says so up front rather than letting someone type
 * a password into a form that cannot submit.
 */
export function AuthApiUnreachable() {
  return (
    <div className="mb-5">
      <ErrorState
        title="Can't reach the Raven API"
        description="Sign-in options could not be loaded, so some may be missing from this page — and signing in will not work until the API is back. If you are running Raven locally, check that the control plane is up on its configured port."
      />
    </div>
  );
}
