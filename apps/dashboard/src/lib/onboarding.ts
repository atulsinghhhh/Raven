export interface OnboardingStep {
  step: number;
  label: string;
  description: string;
  done: boolean;
  href: string;
}

export interface OnboardingSignals {
  hasApiKey: boolean;
  hasConnection: boolean;
  hasChatActivity: boolean;
  hasLiveStream: boolean;
}

/**
 * Five steps, each backed by something Livqeno can actually observe;
 * never a client-side "mark as done" checkbox. Two of them (Install SDK,
 * Create a token) can't be measured directly, since neither has a
 * dedicated resource: they're inferred from the next real signal that
 * couldn't exist without them having happened first. That inference is
 * stated in each step's description, not hidden.
 */
export function buildOnboardingSteps(projectId: string, signals: OnboardingSignals): OnboardingStep[] {
  const base = `/dashboard/projects/${projectId}`;
  const hasActivity = signals.hasConnection || signals.hasChatActivity || signals.hasLiveStream;

  return [
    {
      step: 1,
      label: 'Create a project',
      description: 'Done — you’re looking at it.',
      done: true,
      href: `${base}/overview`,
    },
    {
      step: 2,
      label: 'Install an SDK',
      description: 'Livqeno can’t see a local install directly — marked done once your project shows any real activity.',
      done: signals.hasApiKey || hasActivity,
      href: `${base}/sdks`,
    },
    {
      step: 3,
      label: 'Create an API key',
      description: 'A server-side credential to mint tokens and read project data.',
      done: signals.hasApiKey,
      href: `${base}/api-keys`,
    },
    {
      step: 4,
      label: 'Mint a token and connect',
      description: 'Inferred from at least one successful RTC connection — a token has to work for that to exist.',
      done: signals.hasConnection,
      href: `${base}/quickstart`,
    },
    {
      step: 5,
      label: 'Join RTC, send a chat message, or start a stream',
      description: 'Real traffic in at least one product.',
      done: hasActivity,
      href: `${base}/rooms`,
    },
  ];
}
