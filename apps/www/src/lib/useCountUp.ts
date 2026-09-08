'use client';

import { useEffect, useState } from 'react';

/**
 * Counts up from 0 to `target` over ~900ms once `active` flips true,
 * then holds. Skips straight to `target` under reduced motion: the
 * number itself is the content, the count-up is just polish.
 */
export function useCountUp(target: number, active: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Deferred a frame rather than set synchronously inline: keeps the
      // setState call inside a callback, not the effect body itself.
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }

    const duration = 900;
    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  return value;
}
