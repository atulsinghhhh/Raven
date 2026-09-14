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

export type IntegrationProductId = 'rtc' | 'chat' | 'live-streaming';

export interface IntegrationSignals {
  hasApiKey: boolean;
  /** From the last real POST .../verify call — never a self-reported flag. `null` means never tested. */
  lastVerifiedSuccess: boolean | null;
  /** Real, product-specific activity: rooms/connections for RTC, messages for Chat, streams for Live Streaming. */
  hasProductActivity: boolean;
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
      description:
        'Livqeno can’t see a local install directly — marked done once your project shows any real activity.',
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

/**
 * The per-product checklist on a project's saved integration (quickstart
 * page's wizard), keyed the same way `buildOnboardingSteps` is: every step
 * backed by something Raven can actually observe. "Stack selected" is the
 * one exception, and it's still a real fact rather than a checkbox — this
 * function is only ever called for a product with a saved
 * `ProjectIntegration` row, so reaching step 1 at all already proves it.
 */
export function buildIntegrationSteps(
  projectId: string,
  product: IntegrationProductId,
  productLabel: string,
  signals: IntegrationSignals,
): OnboardingStep[] {
  const base = `/dashboard/projects/${projectId}`;

  return [
    {
      step: 1,
      label: 'Stack selected',
      description: 'Done — you picked this on the quickstart page.',
      done: true,
      href: `${base}/quickstart`,
    },
    {
      step: 2,
      label: 'Install & configure',
      description:
        'Raven can’t see a local install directly — marked done once your project shows an API key or real activity.',
      done: signals.hasApiKey || signals.hasProductActivity,
      href: `${base}/quickstart`,
    },
    {
      step: 3,
      label: 'Connection tested',
      description:
        signals.lastVerifiedSuccess === false
          ? 'The last check failed — see the quickstart page for what to fix.'
          : 'From a real server-side check, not a self-reported status.',
      done: signals.lastVerifiedSuccess === true,
      href: `${base}/quickstart`,
    },
    {
      step: 4,
      label: `First ${productLabel.toLowerCase()} activity`,
      description: 'Real traffic in this product.',
      done: signals.hasProductActivity,
      href: base,
    },
  ];
}
