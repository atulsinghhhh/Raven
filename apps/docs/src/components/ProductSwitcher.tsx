import Link from 'next/link';
import { PRODUCTS, productForSlug } from '../lib/nav';

/**
 * Three fixed products: an inline segmented control instead of a
 * dropdown, since a dropdown adds a click for a choice this small.
 * Server component: which segment is active is derived from
 * `activeSlug`, already known at render time, so no client-side
 * route-matching is needed.
 */
export function ProductSwitcher({ activeSlug }: { activeSlug?: string }) {
  const active = activeSlug ? productForSlug(activeSlug) : undefined;

  return (
    <nav aria-label="Livqeno products" className="mono-label flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 text-[11px]">
      {PRODUCTS.map((product) => {
        const isActive = product.id === active;
        return (
          <Link
            key={product.id}
            href={`/${product.slug}`}
            aria-current={isActive ? 'page' : undefined}
            className={`rounded-sm px-2.5 py-1.5 transition-colors ${
              isActive ? 'bg-accent-subtle text-accent-text' : 'text-muted hover:text-fg'
            }`}
          >
            {product.label}
          </Link>
        );
      })}
    </nav>
  );
}
