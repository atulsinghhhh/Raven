'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, Select } from '@/components/ui/field';
import { IconChat, IconLiveStreaming, IconRooms, RavenMark } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/states';
import type { OnboardingState } from '@/lib/api-client';

// Steps 2–7 are the six a person interacts with; the welcome screen is
// step 1 but isn't worth a progress segment. TOTAL_PROGRESS_STEPS is what
// "Step n of 6" counts.
const TOTAL_PROGRESS_STEPS = 6;
const LAST_STEP = 7;

// Option values are what the API stores (bounded strings, validated
// server-side); labels are what the person reads. Adding an option here is
// a dashboard deploy, not a migration — that's deliberate.
const USE_CASES = [
  { value: 'saas', label: 'SaaS' },
  { value: 'mobile-app', label: 'Mobile app' },
  { value: 'web-app', label: 'Web app' },
  { value: 'social', label: 'Social app' },
  { value: 'communication', label: 'Communication app' },
  { value: 'live-streaming', label: 'Live streaming app' },
  { value: 'ai', label: 'AI application' },
  { value: 'other', label: 'Other' },
];

const EXPERIENCE_LEVELS = [
  { value: 'getting-started', label: 'Just getting started', description: 'New to realtime — we’ll keep it gentle.' },
  { value: 'some-experience', label: 'Some experience', description: 'Shipped a prototype or two.' },
  { value: 'experienced', label: 'Experienced', description: 'Comfortable with WebRTC, sockets, and tokens.' },
  {
    value: 'production',
    label: 'Production realtime developer',
    description: 'Running realtime systems in production today.',
  },
];

const STACKS = [
  { value: 'react', label: 'React' },
  { value: 'nextjs', label: 'Next.js' },
  { value: 'react-native', label: 'React Native' },
  { value: 'flutter', label: 'Flutter' },
  { value: 'nodejs', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'other', label: 'Other' },
];

interface CreatedProject {
  id: string;
  name: string;
  apiKey?: { publicId: string; key: string; environment: string };
}

export function OnboardingFlow({ initialState, hasProjects }: { initialState: OnboardingState; hasProjects: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(() => Math.min(Math.max(initialState.step, 1), LAST_STEP));
  const [useCases, setUseCases] = useState<string[]>(initialState.useCases);
  const [experience, setExperience] = useState<string | null>(initialState.experienceLevel);
  const [stack, setStack] = useState<string[]>(initialState.stack);
  const [project, setProject] = useState<CreatedProject | null>(null);
  const [alreadyHadProject] = useState(hasProjects || initialState.createdFirstProject);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /**
   * Persists progress, then moves. The PATCH is what makes a closed tab
   * resumable; navigation doesn't wait for perfection — a failed save is
   * surfaced but never traps the person on a step.
   */
  async function saveAndGo(nextStep: number, patch: Record<string, unknown> = {}) {
    setError(undefined);
    setBusy(true);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, step: nextStep }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => undefined);
        setError(payload?.message ?? 'Could not save your progress. Please try again.');
        return;
      }
      setStep(nextStep);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Completes onboarding and leaves for the dashboard (or a deeper page). */
  async function completeAndGo(destination: string) {
    setError(undefined);
    setBusy(true);
    try {
      const res = await fetch('/api/onboarding/complete', { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => undefined);
        setError(payload?.message ?? 'Could not finish onboarding. Please try again.');
        return;
      }
      router.push(destination);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <main className="auth-backdrop relative flex min-h-screen flex-col items-center px-4 py-6 sm:py-10">
      <div aria-hidden className="auth-dot-grid absolute inset-0" />

      <div className="relative z-10 flex w-full max-w-2xl flex-1 flex-col">
        <header className="flex h-10 items-center justify-between">
          <span className="flex items-center gap-2">
            <RavenMark className="size-6" />
            <span className="text-sm font-semibold tracking-tight text-fg">Livqeno</span>
          </span>
          <div className="flex items-center gap-4">
            {step > 1 && <ProgressIndicator current={step - 1} total={TOTAL_PROGRESS_STEPS} />}
            <button type="button" onClick={signOut} className="text-xs text-subtle transition-colors hover:text-muted">
              Sign out
            </button>
          </div>
        </header>

        {/* key={step} re-mounts the panel so each step gets its entry
            animation; reduced-motion users get an instant swap. */}
        <section
          key={step}
          className="animate-step-in mt-6 flex flex-1 flex-col rounded-lg border border-line bg-surface/90 p-6 shadow-raven-md backdrop-blur-sm sm:p-10"
        >
          {error && (
            <div className="mb-6">
              <ErrorState title="Something went wrong" description={error} />
            </div>
          )}

          {step === 1 && <WelcomeStep busy={busy} onContinue={() => saveAndGo(2)} />}
          {step === 2 && (
            <ChoiceStep
              eyebrow="About you"
              title="What are you building?"
              subtitle="Pick everything that applies — this shapes the examples we show you."
              options={USE_CASES}
              selected={useCases}
              multi
              onToggle={(value) =>
                setUseCases((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
              }
              busy={busy}
              onBack={() => saveAndGo(1)}
              onContinue={() => saveAndGo(3, { useCases })}
              onSkip={() => saveAndGo(3)}
            />
          )}
          {step === 3 && (
            <ChoiceStep
              eyebrow="Experience"
              title="What’s your experience with realtime technology?"
              subtitle="No wrong answer — nothing here gates anything."
              options={EXPERIENCE_LEVELS}
              selected={experience ? [experience] : []}
              onToggle={(value) => setExperience(value)}
              busy={busy}
              onBack={() => saveAndGo(2)}
              onContinue={() => saveAndGo(4, experience ? { experienceLevel: experience } : {})}
              onSkip={() => saveAndGo(4)}
            />
          )}
          {step === 4 && (
            <ChoiceStep
              eyebrow="Your stack"
              title="What are you building with?"
              subtitle="We’ll put the right SDKs first."
              options={STACKS}
              selected={stack}
              multi
              onToggle={(value) =>
                setStack((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
              }
              busy={busy}
              onBack={() => saveAndGo(3)}
              onContinue={() => saveAndGo(5, { stack })}
              onSkip={() => saveAndGo(5)}
            />
          )}
          {step === 5 && (
            <CreateProjectStep
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              project={project}
              setProject={setProject}
              alreadyHadProject={alreadyHadProject}
              onBack={() => saveAndGo(4)}
              onContinue={() => saveAndGo(6)}
            />
          )}
          {step === 6 && (
            <ConnectStep
              project={project}
              busy={busy}
              onBack={() => saveAndGo(5)}
              onContinue={() => saveAndGo(7)}
              onOpenQuickstart={
                project ? () => completeAndGo(`/dashboard/projects/${project.id}/quickstart`) : undefined
              }
            />
          )}
          {step === 7 && (
            <CompleteStep
              busy={busy}
              onFinish={() => completeAndGo(project ? `/dashboard/projects/${project.id}/overview` : '/dashboard')}
            />
          )}
        </section>
      </div>
    </main>
  );
}

/** "Step 3 of 6" plus a segmented bar. The text is the accessible truth;
 *  the segments are aria-hidden decoration. */
function ProgressIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted">
        Step {current} of {total}
      </span>
      <div aria-hidden className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1 w-5 rounded-full transition-colors ${i < current ? 'bg-accent' : 'bg-line-strong'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** The mono accent line above a step title — the wizard's section label. */
function StepEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mono-label mb-3 text-xs text-accent-text">{children}</p>;
}

function StepActions({
  busy,
  onBack,
  onContinue,
  onSkip,
  continueLabel = 'Continue',
  continueDisabled = false,
}: {
  busy: boolean;
  onBack?: () => void;
  onContinue?: () => void;
  onSkip?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
}) {
  return (
    <div className="mt-auto flex items-center justify-between border-t border-line pt-6">
      <div>
        {onBack && (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip} disabled={busy}>
            Skip
          </Button>
        )}
        {onContinue && (
          <Button onClick={onContinue} loading={busy} disabled={continueDisabled}>
            {continueLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Welcome
// ---------------------------------------------------------------------------

function WelcomeStep({ busy, onContinue }: { busy: boolean; onContinue: () => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center py-4">
      <StepEyebrow>Getting started</StepEyebrow>
      <h1 className="display text-3xl text-fg sm:text-4xl">Welcome to Livqeno</h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-muted">
        Realtime infrastructure for your applications.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CapabilityTile
          icon={<IconRooms className="size-4" />}
          label="RTC"
          description="Build voice and video experiences."
        />
        <CapabilityTile icon={<IconChat className="size-4" />} label="Chat" description="Add realtime messaging." />
        <CapabilityTile
          icon={<IconLiveStreaming className="size-4" />}
          label="Live Streaming"
          description="Build scalable live experiences."
        />
      </div>

      <div className="mt-12">
        <Button onClick={onContinue} loading={busy} size="md">
          Get started
        </Button>
        <p className="mt-3 text-xs text-subtle">Takes about a minute. You can change any answer later.</p>
      </div>
    </div>
  );
}

function CapabilityTile({ icon, label, description }: { icon: React.ReactNode; label: string; description: string }) {
  return (
    <div className="rounded-md border border-line bg-canvas p-4 transition-colors hover:border-line-strong">
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-md border border-accent-line bg-accent-subtle text-accent-text"
      >
        {icon}
      </span>
      <p className="mt-3 text-sm font-medium text-fg">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps 2–4 — choice grids
// ---------------------------------------------------------------------------

function ChoiceStep({
  eyebrow,
  title,
  subtitle,
  options,
  selected,
  multi = false,
  onToggle,
  busy,
  onBack,
  onContinue,
  onSkip,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  options: Array<{ value: string; label: string; description?: string }>;
  selected: string[];
  multi?: boolean;
  onToggle: (value: string) => void;
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <StepEyebrow>{eyebrow}</StepEyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-2 text-sm text-muted">{subtitle}</p>

      <div role="group" aria-label={title} className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              // aria-pressed makes the toggle state audible; multi-select and
              // single-select read the same way, which is fine — both are
              // "pressed or not".
              aria-pressed={active}
              onClick={() => onToggle(option.value)}
              className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-left transition-all ${
                active
                  ? 'border-accent bg-accent-subtle shadow-raven-sm'
                  : 'border-line bg-canvas hover:border-line-strong hover:bg-surface-raised'
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{option.description}</span>
                )}
              </span>
              <span
                aria-hidden
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none transition-colors ${
                  active
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-line-strong bg-transparent text-transparent'
                }`}
              >
                ✓
              </span>
            </button>
          );
        })}
      </div>

      {multi && <p className="mt-3 text-xs text-subtle">Select one or more.</p>}

      <div className="pt-8" />
      <StepActions busy={busy} onBack={onBack} onContinue={onContinue} onSkip={onSkip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — create project
// ---------------------------------------------------------------------------

function CreateProjectStep({
  busy,
  setBusy,
  setError,
  project,
  setProject,
  alreadyHadProject,
  onBack,
  onContinue,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string | undefined) => void;
  project: CreatedProject | null;
  setProject: (p: CreatedProject) => void;
  alreadyHadProject: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<'DEVELOPMENT' | 'PRODUCTION'>('DEVELOPMENT');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const projectRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const created = await projectRes.json();
      if (!projectRes.ok) {
        setError(created.message ?? 'Could not create the project.');
        return;
      }

      // The first credential, minted through the same endpoint the API-keys
      // page uses: the secret is shown exactly once, here, and never again.
      let apiKey: CreatedProject['apiKey'];
      const keyRes = await fetch(`/api/projects/${created.id}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Default', environment }),
      });
      if (keyRes.ok) {
        const key = await keyRes.json();
        apiKey = { publicId: key.publicId, key: key.key, environment: key.environment };
      }

      setProject({ id: created.id, name: created.name, apiKey });

      // Two facts persisted at once: the project exists, and a resume
      // should land on step 6, not back on the create form.
      await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdFirstProject: true, step: 6 }),
      }).catch(() => undefined);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (project) {
    return (
      <div className="flex flex-1 flex-col">
        <StepEyebrow>First project</StepEyebrow>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="animate-scale-in flex size-8 items-center justify-center rounded-full border border-success-line bg-success-subtle text-sm text-success-text"
          >
            ✓
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Project created</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-fg">{project.name}</span> is ready.
        </p>

        {project.apiKey ? (
          <div className="mt-8 rounded-md border border-line bg-canvas p-4">
            <p className="mono-label text-xs text-muted">{project.apiKey.environment} API key</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-sunken px-3 py-2 font-mono text-xs text-fg">
                {project.apiKey.key}
              </code>
              <CopyButton value={project.apiKey.key} label="Copy key" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-warning-text">
              This is the only time the full key is shown. Store it somewhere safe — you can always mint a new one
              later.
            </p>
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted">
            You can create an API key any time from the project’s API Keys page.
          </p>
        )}

        <div className="pt-8" />
        <StepActions busy={busy} onBack={onBack} onContinue={onContinue} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <StepEyebrow>First project</StepEyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Create your first Livqeno project</h1>
      <p className="mt-2 text-sm text-muted">A project holds your rooms, conversations, streams, keys, and usage.</p>

      <form onSubmit={handleCreate} className="mt-8 flex flex-1 flex-col">
        <div className="flex flex-col gap-4">
          <Field
            id="project-name"
            label="Project name"
            placeholder="My realtime app"
            required
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select
            id="project-environment"
            label="Environment for your first API key"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as 'DEVELOPMENT' | 'PRODUCTION')}
          >
            <option value="DEVELOPMENT">Development</option>
            <option value="PRODUCTION">Production</option>
          </Select>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-line pt-6">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <div className="flex items-center gap-2">
            {/* Project creation is mandatory for a fresh account — the only
                skip is for people who already have projects to return to. */}
            {alreadyHadProject && (
              <Button type="button" variant="ghost" onClick={onContinue} disabled={busy}>
                Use an existing project
              </Button>
            )}
            <Button type="submit" loading={busy} disabled={name.trim().length < 2}>
              Create project
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — connect your app
// ---------------------------------------------------------------------------

function ConnectStep({
  project,
  busy,
  onBack,
  onContinue,
  onOpenQuickstart,
}: {
  project: CreatedProject | null;
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
  onOpenQuickstart?: () => void;
}) {
  // Both halves, always. Livqeno's whole auth model is that the API key stays
  // on a server and the browser only ever sees a short-lived grant, so a
  // working integration needs the backend package and the browser package
  // whatever stack the developer picked. Installing only one of them is the
  // shape of integration that ends with an API key in a bundle.
  const installCommand = 'npm install @ravenkash/server   # your backend\nnpm install @ravenkash/rtc      # your browser app';

  // Kept verbatim-runnable against the published SDKs. `createRTCClient` is
  // the real export — there is no `RavenClient` class in @ravenkash/rtc, and
  // a snippet naming one sends a developer's first five minutes into a
  // TypeError. The grant is spread whole: it carries `endpoint`,
  // `iceServers` and `telemetryUrl`, and hand-picking fields off it is how
  // people end up configuring infrastructure Livqeno means to hide.
  const backendSnippet = `import { Raven } from '@ravenkash/server';

const raven = new Raven({ apiKey: process.env.RAVEN_API_KEY });

// Identity comes from *your* session, never from the request body.
app.post('/api/raven-token', async (req, res) => {
  const room = await raven.rooms.create({ name: 'my-first-room' });
  const grant = await raven.tokens.create({
    room: room.id,
    identity: req.user.id,
    permissions: { join: true, subscribe: true, publish: true },
  });
  res.json(grant); // { token, endpoint, iceServers, ... } — no API key
});`;

  const browserSnippet = `import { createRTCClient } from '@ravenkash/rtc';

const grant = await fetch('/api/raven-token', { method: 'POST' }).then((r) => r.json());

const room = await createRTCClient(grant).join(grant.roomName);
await room.enableCamera();
await room.enableMicrophone();`;
  // The real key never renders here — it was shown exactly once on the
  // previous step. The placeholder keeps this snippet honest and paste-safe.
  const keyPlaceholder = project?.apiKey
    ? `<your ${project.apiKey.environment.toLowerCase()} API key>`
    : '<your API key>';

  return (
    <div className="flex flex-1 flex-col">
      <StepEyebrow>Connect</StepEyebrow>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Connect your app</h1>
      <p className="mt-2 text-sm text-muted">Four steps from zero to a live RTC session.</p>

      <ol className="mt-8 flex flex-col gap-5">
        <QuickstartItem index={1} title="Install the SDK">
          <CodeBlock code={installCommand} language="bash" />
        </QuickstartItem>
        <QuickstartItem index={2} title="Configure your API key">
          <CodeBlock code={`RAVEN_API_KEY=${keyPlaceholder}`} language="bash" filename=".env" />
        </QuickstartItem>
        <QuickstartItem index={3} title="Mint a grant on your backend">
          <CodeBlock code={backendSnippet} language="typescript" filename="server.ts" />
        </QuickstartItem>
        <QuickstartItem index={4} title="Connect from the browser">
          <CodeBlock code={browserSnippet} language="typescript" filename="call.ts" />
        </QuickstartItem>
      </ol>

      <p className="mt-5 text-xs leading-relaxed text-subtle">
        The full quickstart covers minting tokens from your backend and every SDK — it’s one click away in your project.
      </p>

      <div className="pt-8" />
      <div className="mt-auto flex items-center justify-between border-t border-line pt-6">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onContinue} disabled={busy}>
            Skip for now
          </Button>
          {onOpenQuickstart ? (
            <Button onClick={onOpenQuickstart} loading={busy}>
              Open quickstart
            </Button>
          ) : (
            <Button onClick={onContinue} loading={busy}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickstartItem({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-accent-line bg-accent-subtle font-mono text-xs text-accent-text"
      >
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Step 7 — complete
// ---------------------------------------------------------------------------

function CompleteStep({ busy, onFinish }: { busy: boolean; onFinish: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center py-4">
      <span
        aria-hidden
        className="animate-scale-in flex size-14 items-center justify-center rounded-full border border-success-line bg-success-subtle text-2xl text-success-text shadow-raven-sm"
      >
        ✓
      </span>
      <p className="mono-label mb-3 mt-6 text-xs text-accent-text">All set</p>
      <h1 className="display text-3xl text-fg sm:text-4xl">You’re ready to build.</h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-muted">
        Your workspace is set up. Rooms, chat, streams, keys, and usage are all waiting in your dashboard.
      </p>
      <div className="mt-10">
        <Button onClick={onFinish} loading={busy} size="md">
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
