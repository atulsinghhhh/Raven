import { getAllSlugs, getDoc } from './docs';
import { NAV } from './nav';
import { rank } from './rank';

/**
 * One searchable unit: a section of a page, not a whole page.
 *
 * Sectioning matters more than it sounds. "How do I mute a mic?" should
 * land on `/rtc/audio-and-video#muting`, not at the top of a 200-line
 * page the reader then has to scan. Every record carries the anchor that
 * gets them there.
 */
export interface SearchRecord {
  /** Page slug, e.g. `rtc/audio-and-video`. */
  slug: string;
  /** Page title from frontmatter — the result's first line. */
  title: string;
  /** Sidebar section the page lives in, e.g. "RTC". Shown as a breadcrumb. */
  group: string;
  /**
   * The page's frontmatter description.
   *
   * Carried on every section of the page, not just the first, because
   * matching is an AND across sections: "mute mic" would otherwise miss
   * the Muting section of Audio & Video, whose own text says "mute" but
   * says "microphone" only in the page description. It's page-level
   * context that genuinely applies to every section.
   */
  description?: string;
  /** The h2 this section sits under, absent for the page's opening text. */
  heading?: string;
  /** Anchor id for `heading`, so a result links straight to it. */
  anchor?: string;
  /** Plain text of the section, truncated — enough to match and to preview. */
  text: string;
}

const MAX_SECTION_CHARS = 1_200;

/**
 * Builds the whole index at build time.
 *
 * It reads the *rendered* HTML rather than the Markdown source, for one
 * specific reason: the heading ids are already in it, put there by
 * rehype-slug. Re-deriving them from the Markdown would mean
 * reimplementing github-slugger's rules and getting a subtly different
 * answer on some heading with a colon in it — producing a search result
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

    for (const section of splitByHeading(doc.html)) {
      const text = section.text.slice(0, MAX_SECTION_CHARS);
      // An h2 with nothing under it is still worth a record — the
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
 * HTML to searchable text. Code blocks are kept deliberately — people
 * search for `enableCamera` and `RAVEN_TOKEN` far more often than for
 * the prose around them.
 */
function toPlainText(html: string): string {
  return html
    // Block-level tags become spaces so words either side don't fuse.
    .replace(/<\/(p|li|h[1-6]|pre|tr|div|blockquote)>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
export function assertIndexIsSound(
  records: SearchRecord[],
  expectedHeadingIds: Map<string, Set<string>>,
): void {
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
  // rewrite quietly making something unfindable — the failure mode
  // nobody notices by hand.
  const MUST_FIND: [query: string, slug: string][] = [
    ['screen share', 'rtc/screen-sharing'],
    ['webhook signature', 'server/webhooks'],
    ['RAVEN_TOKEN', 'sdk/cli'],
    ['audit log', 'production/audit-logs'],
    ['enableCamera', 'rtc/audio-and-video'],
    ['rate limit', 'production/rate-limits'],
    ['chat token', 'server/tokens'],
    ['mute mic', 'rtc/audio-and-video'],
  ];

  for (const [query, slug] of MUST_FIND) {
    if (!rank(records, query).some((r) => r.record.slug === slug)) {
      problems.push(`searching "${query}" no longer reaches ${slug}`);
    }
  }

  // Queries with one unambiguous answer, where being somewhere in the
  // list isn't good enough — the top result is what people click.
  const MUST_RANK_FIRST: [query: string, slug: string][] = [
    ['screen share', 'rtc/screen-sharing'],
    ['webhooks', 'server/webhooks'],
    ['reconnection', 'rtc/reconnection'],
    ['flutter', 'sdk/flutter'],
  ];

  for (const [query, slug] of MUST_RANK_FIRST) {
    const top = rank(records, query)[0];
    if (top?.record.slug !== slug) {
      problems.push(
        `searching "${query}" ranks ${top?.record.slug ?? 'nothing'} first, expected ${slug}`,
      );
    }
  }

  // Fetched in one request when someone opens search. If this trips, the
  // fix is a smarter index, not a bigger download.
  const bytes = Buffer.byteLength(JSON.stringify(records));
  if (bytes > 400_000) {
    problems.push(`search index is ${Math.round(bytes / 1024)} KB, over the 400 KB budget`);
  }

  if (problems.length > 0) {
    throw new Error(`Search index is not sound:\n  - ${problems.join('\n  - ')}`);
  }
}
