'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Fades and lifts its children in once they scroll into view.
 *
 * IntersectionObserver rather than the newer `animation-timeline: view()`
 * CSS: broader support today, and simple enough that reaching for a
 * library would be the wrong trade.
 *
 * Renders fully visible in React's own render output, on server and
 * client alike: the "start hidden, then reveal" state is applied by
 * toggling classes on the DOM node directly inside the effect, never
 * through React state. That keeps a visitor with JS disabled, or a
 * crawler that doesn't execute it, seeing the content immediately (there
 * is no state for the animation to get stuck in), and it sidesteps
 * needing a setState call synchronously inside the effect body for what
 * is a purely visual, imperative concern.
 */
export function Reveal({
  children,
  delayMs = 0,
  className = '',
}: {
  children: ReactNode;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    node.classList.add('opacity-0', 'translate-y-6');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          return;
        }
        node.style.transitionDelay = `${delayMs}ms`;
        node.classList.remove('opacity-0', 'translate-y-6');
        observer.disconnect();
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <div ref={ref} className={`opacity-100 translate-y-0 transition-all duration-700 ease-out ${className}`}>
      {children}
    </div>
  );
}
