import { CodeSample } from './CodeSample';

/**
 * The interactive code panel that used to sit beside the hero diagram —
 * moved to its own strip once the hero became a single centered
 * headline + full-bleed network animation, matching the reference's
 * rhythm of hero (no border) -> brand graphic (no border) -> bordered
 * content below.
 */
export function CodeShowcase() {
  return (
    <section className="border-t border-line py-20">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-[minmax(0,320px)_1fr] md:items-center">
        <div>
          <span className="mono-label text-[11px] text-accent-text">The API</span>
          <h2 className="mt-3 text-2xl font-light tracking-tight text-fg md:text-3xl">
            One SDK. Every real-time product.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            The same token, the same client shape, whether you&apos;re joining a call, opening a chat, or going
            live.
          </p>
        </div>
        <CodeSample />
      </div>
    </section>
  );
}
