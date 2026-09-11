/** Inline SVG icons and the Livqeno brand mark: no icon font/library. */

export function GitHubIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.29 9.42 7.86 10.95.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.68.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function WhatsAppIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.16-1.35a9.94 9.94 0 0 0 4.88 1.27h.01c5.49 0 9.95-4.46 9.95-9.96A9.9 9.9 0 0 0 19.07 5a9.9 9.9 0 0 0-7.03-3Zm0 1.68c2.2 0 4.28.86 5.84 2.42a8.2 8.2 0 0 1 2.42 5.85c0 4.57-3.72 8.28-8.28 8.28a8.26 8.26 0 0 1-4.21-1.15l-.3-.18-3.06.8.82-2.99-.19-.31a8.24 8.24 0 0 1-1.27-4.4c0-4.57 3.72-8.29 8.29-8.29Zm-3.2 4.4c-.15 0-.4.06-.6.28-.21.22-.79.77-.79 1.87s.81 2.17.92 2.32c.11.15 1.57 2.5 3.84 3.41 1.88.75 2.26.6 2.67.56.4-.04 1.3-.53 1.49-1.05.18-.52.18-.96.13-1.06-.06-.09-.21-.15-.44-.26-.22-.11-1.3-.64-1.5-.72-.2-.07-.35-.11-.5.12-.14.22-.57.73-.7.88-.13.15-.26.17-.48.06a5.9 5.9 0 0 1-1.75-1.08c-.66-.58-1.1-1.29-1.23-1.51-.13-.22-.01-.35.1-.46.1-.1.26-.28.39-.42.13-.15.17-.25.26-.42.09-.16.04-.31-.02-.42-.05-.11-.5-1.2-.68-1.65-.15-.36-.3-.37-.43-.38h-.4Z" />
    </svg>
  );
}

export function WhatsAppIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.16-1.35a9.94 9.94 0 0 0 4.88 1.27h.01c5.49 0 9.95-4.46 9.95-9.96A9.9 9.9 0 0 0 19.07 5a9.9 9.9 0 0 0-7.03-3Zm0 1.68c2.2 0 4.28.86 5.84 2.42a8.2 8.2 0 0 1 2.42 5.85c0 4.57-3.72 8.28-8.28 8.28a8.26 8.26 0 0 1-4.21-1.15l-.3-.18-3.06.8.82-2.99-.19-.31a8.24 8.24 0 0 1-1.27-4.4c0-4.57 3.72-8.29 8.29-8.29Zm-3.2 4.4c-.15 0-.4.06-.6.28-.21.22-.79.77-.79 1.87s.81 2.17.92 2.32c.11.15 1.57 2.5 3.84 3.41 1.88.75 2.26.6 2.67.56.4-.04 1.3-.53 1.49-1.05.18-.52.18-.96.13-1.06-.06-.09-.21-.15-.44-.26-.22-.11-1.3-.64-1.5-.72-.2-.07-.35-.11-.5.12-.14.22-.57.73-.7.88-.13.15-.26.17-.48.06a5.9 5.9 0 0 1-1.75-1.08c-.66-.58-1.1-1.29-1.23-1.51-.13-.22-.01-.35.1-.46.1-.1.26-.28.39-.42.13-.15.17-.25.26-.42.09-.16.04-.31-.02-.42-.05-.11-.5-1.2-.68-1.65-.15-.36-.3-.37-.43-.38h-.4Z" />
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
