import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ravenApi } from '@/lib/api-client';
import { getSessionToken } from '@/lib/session';
import { OnboardingFlow } from './onboarding-flow';

export const metadata: Metadata = {
  title: 'Welcome — Raven',
};

/**
 * First-run onboarding. proxy.ts routes here off a cookie hint, but this
 * page re-checks the real state against the Control API: the cookie is
 * routing convenience, this is the authority. Completed accounts are sent
 * straight to the dashboard, which is also what breaks any redirect loop —
 * a stale "pending" cookie lands here once, sees the truth, and leaves.
 */
export default async function OnboardingPage() {
  const token = await getSessionToken();
  if (!token) {
    redirect('/login?next=/onboarding');
  }

  let state;
  let hasProjects = false;
  try {
    const [onboarding, projects] = await Promise.all([
      ravenApi.getOnboarding(token),
      ravenApi.listProjects(token).catch(() => []),
    ]);
    state = onboarding;
    hasProjects = projects.length > 0;
  } catch {
    // A dead session or an API predating onboarding: either way the flow
    // can't run. Login re-issues the cookie pair and routes correctly.
    redirect('/login?next=/onboarding');
  }

  if (state.completed) {
    redirect('/dashboard');
  }

  return <OnboardingFlow initialState={state} hasProjects={hasProjects} />;
}
