/**
 * Pure-data tests against the real NAV: the same style rank.spec.ts
 * uses. This isn't testing fixtures; a change to nav.ts that breaks one
 * of these breaks the actual sidebar/switcher/breadcrumbs for a real
 * reader, so the real NAV is exactly what should be under test here.
 */
import { getAdjacent, findNavItem, productForSlug, NAV, PRODUCTS } from '../src/lib/nav';

describe('productForSlug', () => {
  it('tags every item in a product section with that product', () => {
    expect(productForSlug('rtc')).toBe('rtc');
    expect(productForSlug('rtc/quickstart')).toBe('rtc');
    expect(productForSlug('chat')).toBe('chat');
    expect(productForSlug('chat/moderation')).toBe('chat');
    expect(productForSlug('live-streaming')).toBe('live-streaming');
    expect(productForSlug('live-streaming/filters')).toBe('live-streaming');
    expect(productForSlug('effects')).toBe('effects');
    expect(productForSlug('effects/filters')).toBe('effects');
  });

  it('returns undefined for a slug outside any product section', () => {
    expect(productForSlug('getting-started/introduction')).toBeUndefined();
    expect(productForSlug('sdk/web')).toBeUndefined();
    expect(productForSlug('production/security')).toBeUndefined();
  });

  it('returns undefined for a slug not in NAV at all', () => {
    expect(productForSlug('nonexistent/page')).toBeUndefined();
  });
});

describe('PRODUCTS', () => {
  // Effects is a product by every test that matters — its own package, its own
  // error vocabulary, its own platform integrations — so it carries a product
  // tag and appears in the switcher alongside the other three.
  it('lists exactly the four products, each matching a real NAV section', () => {
    expect(PRODUCTS.map((p) => p.id)).toEqual(['rtc', 'chat', 'live-streaming', 'effects']);

    for (const product of PRODUCTS) {
      const section = NAV.find((s) => s.product === product.id);
      expect(section).toBeDefined();
      // The switcher links straight at the product's landing slug;
      // it must be that section's first item, or the switcher and the
      // sidebar would disagree about what "the product's home" is.
      expect(section!.items[0]?.slug).toBe(product.slug);
    }
  });
});

describe('findNavItem', () => {
  it('finds a real slug and its owning section', () => {
    const entry = findNavItem('chat/messages');
    expect(entry?.section.title).toBe('Chat');
    expect(entry?.item.title).toBe('Messages');
  });

  it('returns undefined for a slug not in NAV', () => {
    expect(findNavItem('nonexistent/page')).toBeUndefined();
  });
});

describe('getAdjacent', () => {
  it('gives no previous page for the very first NAV item', () => {
    const first = NAV[0].items[0].slug;
    expect(getAdjacent(first).prev).toBeUndefined();
  });

  it('gives no next page for the very last NAV item', () => {
    const lastSection = NAV[NAV.length - 1];
    const last = lastSection.items[lastSection.items.length - 1].slug;
    expect(getAdjacent(last).next).toBeUndefined();
  });

  it('steps within a product section in the order items are listed', () => {
    const { prev, next } = getAdjacent('rtc/quickstart');
    expect(prev?.slug).toBe('rtc');
    expect(next?.slug).toBe('rtc/authentication');
  });

  it('returns neither prev nor next for a slug not in NAV', () => {
    expect(getAdjacent('nonexistent/page')).toEqual({});
  });
});

describe('NAV structural invariants', () => {
  it('has no duplicate slug across the whole tree', () => {
    const allSlugs = NAV.flatMap((s) => s.items.map((i) => i.slug));
    expect(new Set(allSlugs).size).toBe(allSlugs.length);
  });

  it('gives every product section a bare product slug as its first item', () => {
    for (const section of NAV) {
      if (!section.product) continue;
      expect(section.items[0]?.slug).toBe(section.product);
    }
  });
});
