import type { OnboardingStep } from '@/lib/onboarding';
import { Card, CardHeader } from '@/components/ui/card';

/**
 * Persistent version of the old all-or-nothing "get started" panel: it
 * shows real progress across all five steps instead of disappearing the
 * moment the project has any activity at all. The parent page decides
 * when to stop rendering it (once every step is done).
 */
export function OnboardingProgress({ steps }: { steps: OnboardingStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card>
      <CardHeader
        title="Get to your first real connection"
        subtitle={`${doneCount} of ${steps.length} steps done.`}
      />
      <ol className="flex flex-col gap-0">
        {steps.map((step, i) => (
          <li key={step.step} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-[0.6875rem] top-6 h-full w-px ${step.done ? 'bg-line-strong' : 'bg-line'}`}
              />
            )}
            <span
              aria-hidden="true"
              className={`z-10 flex size-[1.375rem] shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-medium ${
                step.done
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-line bg-surface text-muted'
              }`}
            >
              {step.done ? (
                <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3.5 8.5l3 3L12.5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                step.step
              )}
            </span>
            <div className="min-w-0 flex-1 pt-px">
              <a
                href={step.href}
                className={`text-sm font-medium hover:underline ${step.done ? 'text-fg' : 'text-accent-text'}`}
              >
                {step.label}
              </a>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
