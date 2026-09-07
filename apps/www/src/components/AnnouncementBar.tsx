import { DOCS_ROUTES } from '../lib/links';

/**
 * The thin strip that sits above the nav — one centered link, nothing
 * else. It points at whatever shipped most recently rather than
 * carrying a permanent tagline, so when the next product lands this is
 * the line that changes.
 */
export function AnnouncementBar() {
  return (
    <div className="border-b border-line bg-surface-sunken">
      <a
        href={DOCS_ROUTES.effects}
        className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-6 py-2 text-[13px] text-muted transition-colors hover:text-fg"
      >
        Introducing Effects — filters on the video track, client-side
        <span aria-hidden="true" className="text-accent-text">
          &rsaquo;
        </span>
      </a>
    </div>
  );
}
