'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * True once the element has scrolled into view, and stays true;
 * one-shot, for count-up numbers and staggered reveals that shouldn't
 * replay every time a section re-enters the viewport.
 *
 * Reduced motion (or no IntersectionObserver, e.g. during SSR) resolves
 * to `true` immediately, not never: a visitor who disabled
 * motion should still see the finished state, not nothing.
 */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    const skipObserving =
      !node || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (skipObserving) {
      // Deferred a frame rather than set synchronously inline: keeps the
      // setState call inside a callback, not the effect body itself.
      const frame = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, inView };
}
