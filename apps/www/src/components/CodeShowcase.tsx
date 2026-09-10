import { CodeSample } from './CodeSample';
import { ProductOverview } from './ProductOverview';

/**
 * The API beat: eyebrow, a light headline carrying the accent on one
 * word, the split editor/preview panel, then the product card grid
 * directly underneath with no heading of its own. It's one block, so
 * the grid reads as "and here's each of them" rather than as a
 * separate section that repeats the pitch.
 */
export function CodeShowcase() {
  return (
    <section className="border-t border-line py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <span className="mono-label text-[11px] text-muted">Simple and powerful APIs</span>
        <h2 className="display mt-4 max-w-2xl text-3xl text-fg md:text-4xl">
          One SDK, every <span className="kw">real-time</span> product
        </h2>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
          The same token and the same client shape, whether you&apos;re joining a call, opening a chat, going live, or
          filtering a camera track.
        </p>

        <div className="mt-10">
          <CodeSample />
        </div>

        <div className="mt-4">
          <ProductOverview />
        </div>
      </div>
    </section>
  );
}
