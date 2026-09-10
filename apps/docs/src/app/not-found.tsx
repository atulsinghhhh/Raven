import Link from 'next/link';
import { DocsNav } from '../components/DocsNav';
import { PRODUCTS } from '../lib/nav';

export default function NotFound() {
  return (
    <>
      <DocsNav />
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center md:px-6">
        <p className="text-sm font-medium text-accent-text">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">This page doesn&apos;t exist.</h1>
        <p className="mt-2 text-muted">
          It may have moved, or the link is out of date. Try search, or jump straight to a product:
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {PRODUCTS.map((product) => (
            <Link
              key={product.id}
              href={`/${product.slug}`}
              className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:border-accent-line hover:bg-surface-raised"
            >
              {product.label}
            </Link>
          ))}
        </div>

        <Link href="/" className="mt-8 text-sm text-accent-text hover:text-accent-hover hover:underline">
          Back to Raven Docs
        </Link>
      </div>
    </>
  );
}
