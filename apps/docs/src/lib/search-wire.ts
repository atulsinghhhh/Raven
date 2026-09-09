/**
 * The search index's data shapes and its wire format.
 *
 * Deliberately separate from `search.ts`, which builds the index and therefore
 * reads the content directory through `node:fs`. `Search.tsx` is a client
 * component: importing anything from `search.ts` other than a type drags
 * `node:fs` into the browser bundle and the build fails outright. Keeping the
 * shapes and the two pure functions here gives both sides something safe to
 * import.
 */

/**
 * One searchable unit: a section of a page, not a whole page.
 *
 * Sectioning matters more than it sounds. "How do I mute a mic?" should land
 * on `/rtc/audio-and-video#muting`, not at the top of a 200-line page the
 * reader then has to scan. Every record carries the anchor that gets them
 * there.
 */
export interface SearchRecord {
  /** Page slug, e.g. `rtc/audio-and-video`. */
  slug: string;
  /** Page title from frontmatter: the result's first line. */
  title: string;
  /** Sidebar section the page lives in, e.g. "RTC". Shown as a breadcrumb. */
  group: string;
  /**
   * The page's frontmatter description.
   *
   * Carried on every section of the page, not just the first, because
   * matching is an AND across sections: "mute mic" would otherwise miss the
   * Muting section of Audio & Video, whose own text says "mute" but says
   * "microphone" only in the page description. It's page-level context that
   * genuinely applies to every section.
   */
  description?: string;
  /** The h2 this section sits under, absent for the page's opening text. */
  heading?: string;
  /** Anchor id for `heading`, so a result links straight to it. */
  anchor?: string;
  /** Plain text of the section, truncated: enough to match and to preview. */
  text: string;
}

/**
 * The shape actually sent to the browser.
 *
 * `SearchRecord` is what `rank()` works on, and it repeats the page's slug,
 * title, group and description on every one of its sections. That is right for
 * ranking — matching is an AND across a section *plus* its page context — and
 * wrong for the wire, where ~950 sections across ~140 pages meant the same
 * description serialised eight or nine times over.
 *
 * So the payload is normalised: a page table, and sections pointing into it by
 * index. The keys are single letters for the same reason — at this record
 * count the key names alone were tens of kilobytes. The client expands it back
 * into `SearchRecord[]` once, on first open, and nothing downstream knows the
 * difference.
 */
export interface CompactSearchIndex {
  /** `[slug, title, group, description?]` */
  p: [string, string, string, string?][];
  /** `[pageIndex, text, heading?, anchor?]` */
  s: [number, string, string?, string?][];
}

export function compactIndex(records: SearchRecord[]): CompactSearchIndex {
  const pageIndex = new Map<string, number>();
  const pages: CompactSearchIndex['p'] = [];
  const sections: CompactSearchIndex['s'] = [];

  for (const record of records) {
    let index = pageIndex.get(record.slug);
    if (index === undefined) {
      index = pages.length;
      pageIndex.set(record.slug, index);
      pages.push([record.slug, record.title, record.group, record.description]);
    }
    sections.push([index, record.text, record.heading, record.anchor]);
  }

  return { p: pages, s: sections };
}

export function expandIndex(compact: CompactSearchIndex): SearchRecord[] {
  return compact.s.map(([page, text, heading, anchor]) => {
    const [slug, title, group, description] = compact.p[page];
    return { slug, title, group, description, heading, anchor, text };
  });
}
