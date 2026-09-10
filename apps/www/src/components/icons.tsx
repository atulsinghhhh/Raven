/** Inline SVG icons and the Livqeno brand mark: no icon font/library. */

export function GitHubIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.42 7.86 10.95.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.68.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function XIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.62l-5.21-6.82-5.96 6.82H1.68l7.73-8.84L1.25 2.25h6.79l4.71 6.23 5.49-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12Z" />
    </svg>
  );
}

export function DiscordIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.3 18.3 0 0 0-5.48 0 12.6 12.6 0 0 0-.62-1.26.08.08 0 0 0-.08-.04c-1.7.29-3.36.8-4.89 1.52a.07.07 0 0 0-.03.03C.98 8.6.28 12.7.62 16.75a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1 0-.13c.13-.09.25-.19.37-.28a.07.07 0 0 1 .08 0c3.93 1.8 8.18 1.8 12.06 0a.07.07 0 0 1 .08 0c.12.1.24.19.37.28a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.78 1.37 1.23 2a.08.08 0 0 0 .08.03 19.85 19.85 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.4-4.7-.67-8.76-2.83-12.35a.06.06 0 0 0-.03-.03ZM8.02 14.34c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.21 0 2.17 1.09 2.15 2.41 0 1.32-.95 2.4-2.15 2.4Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.96-2.41 2.15-2.41 1.21 0 2.17 1.09 2.15 2.41 0 1.32-.94 2.4-2.15 2.4Z" />
    </svg>
  );
}

/**
 * The Livqeno glyph — a monogram L with three concentric arcs opening off
 * its stem: the brand's "signal leaving the stack" idea, and the reason the
 * mark reads as realtime rather than as a bird. Arcs are stroked and the L
 * is filled, both on `currentColor`, so the whole glyph inherits whatever
 * the chip below sets. Master artwork: `assests/livqeno-mark.svg`.
 */
export function RavenGlyph({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M16.04 12.46A5 5 0 0 1 16.04 19.54" />
        <path d="M18.51 9.99A8.5 8.5 0 0 1 18.51 22.01" />
        <path d="M20.99 7.51A12 12 0 0 1 20.99 24.49" />
      </g>
      <path d="M8 7.5h3.5v13.7H16v3.3H8z" />
    </svg>
  );
}

/**
 * The brand mark: the glyph in electric lime on an ink chip. That pairing
 * is the one place the design system allows lime — never lime sitting on
 * the light canvas — and it inverts with the theme, because `--accent` and
 * `--accent-fg` swap in dark mode.
 */
export function RavenMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg ${className}`}
    >
      <RavenGlyph className="w-[70%]" />
    </span>
  );
}
