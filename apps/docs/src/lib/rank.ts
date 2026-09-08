import type { SearchRecord } from './search-wire';

export interface RankedResult {
  record: SearchRecord;
  score: number;
  /** The sentence around the first match, for the result preview. */
  excerpt: string;
}

/**
 * Scoring weights. A match in a title beats one in a heading, which beats
 * one in body text. Somebody typing "webhooks" wants the Webhooks page, not
 * a paragraph on some other page that mentions webhooks in passing.
 */
const WEIGHT = {
  title: 12,
  heading: 6,
  /** Page-level context. Real, but never as strong a signal as the section's own words. */
  description: 3,
  text: 1,
  exactPhrase: 20,
  prefix: 0.5,
  /**
   * A page whose *title* accounts for the whole query is almost always the
   * one somebody's after.
   *
   * Without this, "screen share" ranked a Flutter subheading above the
   * Screen Sharing page, because the subheading contained the literal
   * phrase and "Screen Sharing" doesn't contain the substring "share ".
   */
  allTermsInTitle: 25,
  /**
   * The page's title *is* the query.
   *
   * A weaker signal would not do here. Searching "webhooks" put the
   * generated Webhooks **API** page first, because its endpoint table repeats
   * the word often enough to out-score the prose page actually titled
   * "Webhooks". Containing the term and being named the term are different
   * claims, and only the second one is nearly always the answer.
   */
  exactTitle: 30,
} as const;

/**
 * Ceiling on how much one term's body-text occurrences can contribute.
 *
 * Without it, text weight is unbounded and a long page beats a precise
 * title match purely by length: "screen share" ranked the 200-line
 * Add screen sharing *guide* above the Screen Sharing *reference*, because
 * the guide says the words twelve more times. A page that mentions a term
 * forty times is not forty times more relevant than one that mentions it
 * five times, so the signal saturates — the same reason real ranking
 * functions use term-frequency saturation rather than a raw count.
 */
const MAX_TEXT_HITS_PER_TERM = 6;

const MAX_RESULTS = 12;
const EXCERPT_RADIUS = 90;

/**
 * Suffixes we strip to get a term's stem, longest first.
 *
 * Without this, "screen share" misses the Screen Sharing page completely,
 * because "share" isn't a substring of "sharing", while happily matching a
 * Flutter subheading that used the exact words. People type "token" and
 * "tokens", "reconnect" and "reconnection", interchangeably.
 *
 * This is not a stemmer in the Porter sense and isn't trying to be. Four
 * suffix rules with a length floor is about as much cleverness as a
 * 38-page site can justify: enough to close the plural and gerund gap, not
 * enough to start throwing up surprising matches.
 */
const SUFFIXES = ['ing', 'ies', 'es', 'ed', 's', 'e'] as const;
const MIN_STEM_LENGTH = 4;

/**
 * Words dropped from a query before matching.
 *
 * Search is an AND across terms, so without this a perfectly reasonable
 * question like "how do I mute a mic" finds absolutely nothing. Every word
 * has to appear on the same page, and "how" is on 15 of 38 pages while
 * "mute" is on 7. Dropping the connective tissue leaves the terms actually
 * carrying the question.
 *
 * Kept short on purpose. Anything that could be part of a real query
 * ("no", "not", "off") stays in.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'why',
  'with',
  'you',
  'your',
]);

/**
 * The longest prefix of `term` left after removing one known suffix,
 * or `term` itself when no rule applies or the result would be too
 * short to be meaningful ("mute" stays "mute", not "mut").
 */
export function stem(term: string): string {
  for (const suffix of SUFFIXES) {
    if (term.length > suffix.length + MIN_STEM_LENGTH - 1 && term.endsWith(suffix)) {
      const stemmed = term.slice(0, -suffix.length);
      if (stemmed.length >= MIN_STEM_LENGTH) return stemmed;
    }
  }
  return term;
}

/**
 * Ranks the index against a query.
 *
 * A plain function on purpose: no index-time preprocessing, no dependency.
 * 38 pages is a few hundred records, and that scans in well under a frame on
 * any device capable of running a video call. A trie or an inverted index
 * would be faster, and would also be code nobody here needs to maintain.
 */
export function rank(records: SearchRecord[], query: string): RankedResult[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) return [];

  const terms = queryTerms(trimmed);
  const results: RankedResult[] = [];

  for (const record of records) {
    const title = record.title.toLowerCase();
    const heading = record.heading?.toLowerCase() ?? '';
    const description = record.description?.toLowerCase() ?? '';
    const text = record.text.toLowerCase();
    const haystack = `${title} ${heading} ${description} ${text}`;

    // Every term has to appear somewhere, so "chat token" doesn't match a
    // page that only says "chat". An AND search, which is what people
    // expect when they add a word to narrow things down.
    if (!terms.every((term) => haystack.includes(term))) continue;

    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += WEIGHT.title;
      if (heading.includes(term)) score += WEIGHT.heading;
      if (description.includes(term)) score += WEIGHT.description;
      score += Math.min(countOccurrences(text, term), MAX_TEXT_HITS_PER_TERM) * WEIGHT.text;
      // A title that *starts* with the term is a stronger signal than
      // one that merely contains it.
      if (title.startsWith(term)) score += WEIGHT.title * WEIGHT.prefix;
    }

    // Phrase bonus uses the query as typed. A stemmed "phrase" isn't one.
    if (terms.length > 1 && haystack.includes(trimmed)) score += WEIGHT.exactPhrase;
    if (terms.every((term) => title.includes(term))) score += WEIGHT.allTermsInTitle;
    if (title === trimmed) score += WEIGHT.exactTitle;

    results.push({ record, score, excerpt: excerptAround(record.text, terms[0]) });
  }

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        // A genuine tie goes to the shallower page. In this IA the canonical
        // page for a concept sits at the top of its section — `/webhooks`,
        // not `/api/webhooks` — so depth is a real signal about which page a
        // bare term means. Falling through to an alphabetical compare instead
        // silently handed "webhooks" to whichever slug sorted first.
        slugDepth(a.record.slug) - slugDepth(b.record.slug) ||
        a.record.slug.localeCompare(b.record.slug),
    )
    .slice(0, MAX_RESULTS);
}

/** Path segments in a slug: `webhooks` is 1, `api/webhooks` is 2. */
function slugDepth(slug: string): number {
  return slug.split('/').length;
}

/**
 * A query as typed → the terms we actually match on: stopwords removed,
 * everything stemmed.
 *
 * When a query is nothing but stopwords, "how to" say, we keep the words
 * instead of searching for nothing. A literal match beats an empty result
 * list.
 */
export function queryTerms(query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((word) => !STOPWORDS.has(word));

  return (meaningful.length > 0 ? meaningful : words).map(stem);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * A window of text around the first match, so the reader can tell which
 * result is theirs without opening each one.
 */
function excerptAround(text: string, term: string): string {
  const at = text.toLowerCase().indexOf(term);
  if (at === -1) return text.slice(0, EXCERPT_RADIUS * 2);

  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(text.length, at + term.length + EXCERPT_RADIUS);

  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Splits a string into matched and unmatched runs, so the caller can mark
 * up the matches.
 *
 * Returning data rather than HTML keeps this testable, and keeps
 * `dangerouslySetInnerHTML` out of the search results, where the text comes
 * from a file and the query comes from a user.
 */
export function highlight(text: string, query: string): { text: string; match: boolean }[] {
  // The same terms rank() matched on: stopwords out, everything stemmed. So
  // a result matched via "share" → "Sharing" shows the reader why, and a
  // stopword doesn't light up half the excerpt.
  const terms = queryTerms(query).filter((term) => term.length >= 2);

  if (terms.length === 0) return [{ text, match: false }];

  const lower = text.toLowerCase();
  const marks: boolean[] = new Array(text.length).fill(false);

  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at === -1) break;
      for (let i = at; i < at + term.length; i++) marks[i] = true;
      from = at + term.length;
    }
  }

  // A one-character whitespace gap between two matched runs is nearly
  // always the space inside the query itself: "rtc token" against "rtc
  // tokens". Bridging it renders one highlight instead of two boxes with a
  // sliver of unhighlighted space wedged between them.
  for (let i = 1; i < marks.length - 1; i++) {
    if (!marks[i] && marks[i - 1] && marks[i + 1] && /\s/.test(text[i])) marks[i] = true;
  }

  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const match = marks[cursor];
    let end = cursor;
    while (end < text.length && marks[end] === match) end++;
    parts.push({ text: text.slice(cursor, end), match });
    cursor = end;
  }

  return parts;
}
