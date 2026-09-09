// @ts-expect-error -- plain .mjs script, no types; the export under test is a pure string function
import { headingSlug } from '../../../scripts/verify-docs.mjs';

/**
 * `scripts/verify-docs.mjs` reimplements `github-slugger` so it can check that
 * every `](/page#anchor)` in the docs points at a heading that exists. If that
 * reimplementation drifts, the link checker starts reporting correct links as
 * broken — which is exactly what happened while it was being written, on every
 * page with an em-dash in a heading.
 *
 * These are the cases that matter, verified against github-slugger 2.0 itself.
 */
describe('headingSlug', () => {
  it('lowercases and hyphenates a plain heading', () => {
    expect(headingSlug('Rooms and Participants')).toBe('rooms-and-participants');
  });

  it('leaves two hyphens where punctuation sat between two spaces', () => {
    // The subtle one: punctuation is removed *before* spaces become hyphens,
    // and each space becomes its own hyphen. Collapsing whitespace first
    // yields `authorization-two-independent-checks`, which is wrong.
    expect(headingSlug('Authorization — two independent checks')).toBe('authorization--two-independent-checks');
  });

  it('strips backticks, parentheses and commas', () => {
    expect(headingSlug('`getDiagnostics()` — cheap, synchronous, always safe')).toBe(
      'getdiagnostics--cheap-synchronous-always-safe',
    );
  });

  it('strips a trailing period inside a phrase', () => {
    expect(headingSlug('Muting vs. unpublishing')).toBe('muting-vs-unpublishing');
  });

  it('keeps underscores', () => {
    expect(headingSlug('The RAVEN_NOT_CONFIGURED case')).toBe('the-raven_not_configured-case');
  });

  it('suffixes repeats the way an anchor on a real page would be', () => {
    const seen = new Map<string, number>();
    expect(headingSlug('Next steps', seen)).toBe('next-steps');
    expect(headingSlug('Next steps', seen)).toBe('next-steps-1');
  });
});
