'use client';

import { useEffect, useState } from 'react';
import { useInView } from '../lib/useInView';

/**
 * The workflow beat, as a single bordered card: numbered steps down the
 * left with the active one expanded to reveal its detail, and a layered
 * isometric stack on the right.
 *
 * The reference drives the active step by pinning the section and
 * hijacking the scroll wheel. This advances on a timer once the card is
 * in view, and yields to a click or keypress the moment the reader
 * takes over: same reveal, without taking the scrollbar away from
 * someone who just wants to get past it.
 */
const STEPS = [
  {
    title: 'Mint a token on your backend',
    body: 'Your server holds the API key and decides who a user is. It asks Livqeno for a short-lived token scoped to one room and one set of permissions.',
  },
  {
    title: 'Connect from the client',
    body: 'Hand that token to @ravenkash/rtc, @ravenkash/chat, or @ravenkash/client — plus @ravenkash/effects for filters on the camera track. The SDK never sees your API key, and can only do what the token explicitly grants.',
  },
  {
    title: 'Build the feature, not the plumbing',
    body: 'Reconnection, presence, diagnostics, and event delivery are handled underneath. You write the call screen, the chat panel, or the stream page.',
  },
  {
    title: 'Watch what your rooms are doing',
    body: 'Connection state, reconnects, and dependency health land in the dashboard per project, and lifecycle events reach your backend over webhooks without polling.',
  },
];

const ADVANCE_MS = 4200;

export function HowItWorks() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (!inView || manual) {
      return;
    }
    const timer = setInterval(() => setActive((i) => (i + 1) % STEPS.length), ADVANCE_MS);
    return () => clearInterval(timer);
  }, [inView, manual]);

  function select(index: number) {
    setManual(true);
    setActive(index);
  }

  return (
    <section id="workflow" className="border-t border-line py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <div ref={ref} className="relative overflow-hidden rounded-(--radius-panel) border border-line bg-surface-sunken/40">
          <IsoStack activeLayer={active} />

          <div className="relative max-w-xl p-8 md:p-12">
            <h2 className="display text-3xl text-fg md:text-4xl">
              <span className="kw">How</span> it works
            </h2>

            <ol className="mt-8 flex flex-col">
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative pl-11">
                  {/* The connector between numbers; skipped on the last
                      step so the line doesn't dangle past the end. */}
                  {i < STEPS.length - 1 && (
                    <span className="absolute left-[11px] top-7 h-[calc(100%-1.25rem)] w-px bg-line" aria-hidden="true" />
                  )}

                  <span
                    className={`mono-label absolute left-0 top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[10px] transition-colors ${
                      i === active ? 'border-accent-line bg-accent-subtle text-accent-text' : 'border-line bg-canvas text-muted'
                    }`}
                  >
                    {i + 1}
                  </span>

                  <button
                    type="button"
                    onClick={() => select(i)}
                    aria-expanded={i === active}
                    className={`block pb-5 text-left text-[15px] font-medium transition-colors ${
                      i === active ? 'text-fg' : 'text-muted hover:text-fg'
                    }`}
                  >
                    {step.title}

                    {/* Grid-rows animation rather than max-height: the
                        body's own height decides the target, so a
                        translated or reflowed step never clips. */}
                    <span
                      className="grid transition-[grid-template-rows] duration-500 ease-out"
                      style={{ gridTemplateRows: i === active ? '1fr' : '0fr' }}
                    >
                      <span className="overflow-hidden">
                        <span className="block pt-2 text-sm font-normal leading-relaxed text-muted">{step.body}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Four translucent planes stacked in 3D, one per step, with the active
 * one lit. Bleeds off the right edge and is hidden below lg, where
 * there is no room beside the step list for it to occupy.
 */
function IsoStack({ activeLayer }: { activeLayer: number }) {
  return (
    <div
      className="pointer-events-none absolute -right-16 top-1/2 hidden h-[30rem] w-[34rem] -translate-y-1/2 lg:block"
      style={{ perspective: '1600px' }}
      aria-hidden="true"
    >
      <div className="relative h-full w-full" style={{ transform: 'rotateX(56deg) rotateZ(-40deg)', transformStyle: 'preserve-3d' }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`dot-band absolute left-0 top-0 h-56 w-80 rounded-(--radius-panel) border transition-colors duration-700 ${
              i === activeLayer ? 'border-accent-line bg-accent-subtle/40' : 'border-line bg-surface/40'
            }`}
            style={{ transform: `translate3d(${i * 46}px, ${i * -46}px, ${i * 58}px)` }}
          />
        ))}
      </div>
    </div>
  );
}
