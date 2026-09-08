import { getAllSlugs, getDoc } from './docs';
import { NAV } from './nav';
import { rank } from './rank';
import { compactIndex, type SearchRecord } from './search-wire';

// Re-exported so existing importers keep working; the shapes live in
// search-wire.ts because a client component cannot import this module.
export { compactIndex, expandIndex } from './search-wire';
export type { CompactSearchIndex, SearchRecord } from './search-wire';

/**
 * How much of a section's text is indexed.
 *
 * Two jobs: matching, and the result preview. 1,200 characters was generous
 * for both, and at ~950 sections it put the payload over its budget. 800 is
 * still several sentences past the excerpt window, so previews are unchanged
 * in practice — what it trims is the tail of long sections, which only ever
 * mattered for a match no shorter section already had.
 */
const MAX_SECTION_CHARS = 800;

/**
 * Builds the whole index at build time.
 *
 * It reads the *rendered* HTML, not the Markdown source, for one
 * specific reason: the heading ids are already in it, put there by
 * rehype-slug. Re-deriving them from the Markdown would mean
 * reimplementing github-slugger's rules and getting a subtly different
 * answer on some heading with a colon in it: producing a search result
 * that links to an anchor that doesn't exist.
 */
export async function buildSearchIndex(): Promise<SearchRecord[]> {
  const groupBySlug = new Map<string, string>();
  for (const section of NAV) {
    for (const item of section.items) groupBySlug.set(item.slug, section.title);
  }

  const records: SearchRecord[] = [];
  // Collected alongside, so the soundness check can confirm every
  // indexed anchor is one the rendered page actually has.
  const headingIds = new Map<string, Set<string>>();

  for (const slug of getAllSlugs().sort()) {
    const doc = await getDoc(slug);
    if (!doc) continue;

    const group = groupBySlug.get(slug) ?? 'Reference';
    headingIds.set(slug, new Set(doc.headings.map((h) => h.id)));

    for (const section of splitByHeading(doc.searchHtml)) {
      const text = section.text.slice(0, MAX_SECTION_CHARS);
      // An h2 with nothing under it is still worth a record: the
      // heading itself is what someone is searching for.
      if (!text && !section.heading) continue;

      records.push({
        slug,
        title: doc.title,
        group,
        description: doc.description,
        heading: section.heading,
        anchor: section.anchor,
        text,
      });
    }
  }

  assertIndexIsSound(records, headingIds);

  return records;
}

interface HtmlSection {
  heading?: string;
  anchor?: string;
  text: string;
}

/**
 * Cuts rendered HTML into sections at each `<h2>`. Content before the
 * first h2 becomes the page's intro section, with no anchor.
 */
function splitByHeading(html: string): HtmlSection[] {
  const pattern = /<h2[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g;
  const sections: HtmlSection[] = [];

  const matches = [...html.matchAll(pattern)];

  const introEnd = matches.length > 0 ? matches[0].index : html.length;
  const intro = toPlainText(html.slice(0, introEnd));
  if (intro) sections.push({ text: intro });

  matches.forEach((match, i) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : html.length;

    sections.push({
      heading: toPlainText(match[2]),
      anchor: match[1],
      text: toPlainText(html.slice(bodyStart, bodyEnd)),
    });
  });

  return sections;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * HTML to searchable text. Code blocks are kept on purpose: people
 * search for `enableCamera` and `RAVEN_TOKEN` far more often than for
 * the prose around them.
 */
function toPlainText(html: string): string {
  return (
    html
      // Block-level tags become spaces so words either side don't fuse.
      .replace(/<\/(p|li|h[1-6]|pre|tr|div|blockquote)>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Build-time integrity checks on the finished index.
 *
 * These live here, not in a jest suite, for the same reason
 * `assertNavMatchesContent` does: the Markdown pipeline is ESM-only and
 * the check is only meaningful against the real content directory. Run
 * from the route handler, so a docs build fails rather than shipping
 * search that quietly can't find things.
 *
 * `expectedHeadingIds` is keyed by slug and comes from the same
 * extraction the "On this page" rail uses.
 */
export function assertIndexIsSound(records: SearchRecord[], expectedHeadingIds: Map<string, Set<string>>): void {
  const problems: string[] = [];

  const covered = new Set(records.map((r) => r.slug));
  for (const slug of getAllSlugs()) {
    if (!covered.has(slug)) problems.push(`${slug} produced no search records — it is unfindable`);
  }

  for (const record of records) {
    // A result linking to an anchor the page doesn't have scrolls
    // nowhere and reads as a broken link.
    if (record.anchor && !expectedHeadingIds.get(record.slug)?.has(record.anchor)) {
      problems.push(`${record.slug} indexed anchor #${record.anchor}, which is not on the page`);
    }
    if (/<[a-z/][^>]*>/i.test(record.text)) {
      problems.push(`${record.slug} indexed text still contains HTML tags`);
    }
    if (/&(amp|lt|gt|quot|nbsp|#x27|#39);/.test(record.text)) {
      problems.push(`${record.slug} indexed text still contains HTML entities`);
    }
  }

  // Queries a developer would plausibly type, each with the page it must
  // reach. This is the check that catches a ranking change or a content
  // rewrite quietly making something unfindable: the failure mode
  // nobody notices by hand.
  const MUST_FIND: [query: string, slug: string][] = [
    ['screen share', 'rtc/screen-sharing'],
    ['webhook signature', 'webhooks'],
    ['RAVEN_TOKEN', 'sdk/cli'],
    ['audit log', 'production/audit-logs'],
    ['enableCamera', 'rtc/audio-and-video'],
    ['rate limit', 'production/rate-limits'],
    ['chat token', 'authentication/tokens'],
    ['mute mic', 'rtc/audio-and-video'],
    ['viewer publish', 'live-streaming/viewers'],
    ['live stream lifecycle', 'live-streaming/streams'],
    ['API_PUBLIC_URL', 'self-hosting/environment-variables'],
    ['idempotency key', 'backend/idempotency'],
    ['signaling protocol', 'rtc/signaling-protocol'],
    ['known limitations', 'reference/known-limitations'],
    ['production checklist', 'production/checklist'],
  ];

  for (const [query, slug] of MUST_FIND) {
    if (!rank(records, query).some((r) => r.record.slug === slug)) {
      problems.push(`searching "${query}" no longer reaches ${slug}`);
    }
  }

  // Queries with one unambiguous answer, where being somewhere in the
  // list isn't good enough: the top result is what people click.
  const MUST_RANK_FIRST: [query: string, slug: string][] = [
    ['screen share', 'rtc/screen-sharing'],
    ['webhooks', 'webhooks'],
    ['reconnection', 'rtc/reconnection'],
    ['flutter', 'sdk/flutter'],
    ['concepts', 'concepts'],
    ['quickstart', 'getting-started/quickstart'],
  ];

  for (const [query, slug] of MUST_RANK_FIRST) {
    const top = rank(records, query)[0];
    if (top?.record.slug !== slug) {
      problems.push(`searching "${query}" ranks ${top?.record.slug ?? 'nothing'} first, expected ${slug}`);
    }
  }

  // Fetched in one request when someone opens search, so it is a real cost.
  // Measured on the *compact* form, because that is what crosses the network.
  //
  // The budget was 400 KB when the site was 79 pages. It is 140 now, with a
  // generated REST reference that did not exist before, and the honest reading
  // is that the ceiling moved with the content rather than that the index
  // regressed. Two things were done before raising it: the payload was
  // normalised into a page table plus section rows, which took ~160 KB out,
  // and the per-section text cap came down from 1,200 characters to 800.
  //
  // 500 KB is still a single fetch on first ⌘K, parsed in a few milliseconds.
  // If this trips again, the fix is a smarter index — indexing each generated
  // endpoint under its own heading would make routes individually findable
  // *and* is the next real improvement available here — not a bigger number.
  const bytes = Buffer.byteLength(JSON.stringify(compactIndex(records)));
  if (bytes > 500_000) {
    problems.push(`search index is ${Math.round(bytes / 1024)} KB, over the 500 KB budget`);
  }

  if (problems.length > 0) {
    throw new Error(`Search index is not sound:\n  - ${problems.join('\n  - ')}`);
  }
}
