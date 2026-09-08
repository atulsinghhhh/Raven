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
