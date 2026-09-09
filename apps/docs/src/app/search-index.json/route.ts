import { buildSearchIndex, compactIndex } from '../../lib/search';

/**
 * The search index, generated once at build time and served as a static
 * file.
 *
 * It's a separate route, not a prop on every page for a reason: embedding the
 * index into every statically-rendered page would pay for search on every
 * page load, including the ones where nobody opens it. Here the client fetches
 * it exactly once, the first time someone actually presses ⌘K.
 */
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  // Throws, and so fails the build, if a page became unfindable, an
  // anchor stopped resolving, or a known query stopped reaching its
  // page. See assertIndexIsSound.
  const records = await buildSearchIndex();

  // Normalised for the wire; the client expands it. See CompactSearchIndex.
  return new Response(JSON.stringify(compactIndex(records)), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Immutable in practice: a content change means a new build.
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
}
