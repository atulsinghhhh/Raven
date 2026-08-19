import Link from 'next/link';
import { PRODUCTS, productForSlug } from '../lib/nav';

/**
 * Three fixed products — an inline pill switcher rather than a dropdown
 * menu, since a dropdown adds a click for a choice this small. Server
 * component: which pill is active is derived from `activeSlug`, already
 * known at render time, so no client-side route-matching is needed.
 */
export function ProductSwitcher({ activeSlug }: { activeSlug?: string }) {
  const active = activeSlug ? productForSlug(activeSlug) : undefined;

  return (
    <nav aria-label="Raven products" className="flex items-center gap-1 rounded-full border border-line bg-surface p-0.5 text-sm">
      {PRODUCTS.map((product) => {
        const isActive = product.id === active;
        return (
          <Link
            key={product.id}
            href={`/${product.slug}`}
            aria-current={isActive ? 'page' : undefined}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
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
