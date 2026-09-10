import { WHATSAPP_URL } from '../lib/links';
import { WhatsAppIcon } from './icons';

/**
 * The one persistent contact affordance on the page: a direct WhatsApp
 * chat, pinned bottom-right through the whole scroll.
 *
 * Painted in the site's own ink-and-lime accent rather than WhatsApp's
 * green. The green would read as a third-party widget bolted onto the
 * page — and everything else here is one palette, so a lone brand colour
 * would be the only thing on the landing page that isn't.
 *
 * No entrance animation and no auto-opening bubble. A floating button that
 * moves on its own competes with the content for attention every time the
 * page loads, and the thing it is competing with is the reason anyone came.
 *
 * `bottom-5 right-5` clears the footer's padding at every breakpoint, and
 * nothing else on this page is fixed, so there is no stacking to fight.
 */
export function WhatsAppFloat() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Chat on WhatsApp"
      title="Chat on WhatsApp"
      className="glow-accent fixed right-5 bottom-5 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none md:h-14 md:w-14"
    >
      <WhatsAppIcon className="h-6 w-6 md:h-7 md:w-7" />
    </a>
  );
}
