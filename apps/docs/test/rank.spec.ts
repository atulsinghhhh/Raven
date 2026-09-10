import { highlight, queryTerms, rank, stem } from '../src/lib/rank';
import type { SearchRecord } from '../src/lib/search';

function record(partial: Partial<SearchRecord> & { slug: string; title: string }): SearchRecord {
  return { group: 'Reference', text: '', ...partial };
}

const INDEX: SearchRecord[] = [
  record({
    slug: 'server/webhooks',
    title: 'Webhooks',
    group: 'Server',
    text: 'Every webhook delivery is signed. Verify the signature before trusting the payload.',
  }),
  record({
    slug: 'rtc/overview',
    title: 'RTC Overview',
    group: 'RTC',
    heading: 'Events',
    anchor: 'events',
    text: 'Rooms emit events for participants joining and leaving. A webhook is not involved here.',
  }),
  record({
    slug: 'sdk/cli',
    title: 'CLI',
    group: 'SDKs',
    heading: 'Authenticate',
    anchor: 'authenticate',
    text: 'Set RAVEN_TOKEN in CI. On a laptop, raven login opens a browser.',
  }),
];

describe('rank', () => {
  it('returns nothing for a query too short to be meaningful', () => {
    // A single character matches most of the site: showing 12 arbitrary
    // pages is worse than showing none.
    expect(rank(INDEX, 'w')).toEqual([]);
    expect(rank(INDEX, '')).toEqual([]);
    expect(rank(INDEX, '   ')).toEqual([]);
  });

  it('ranks a title match above a passing mention in body text', () => {
    // Someone typing "webhooks" wants the Webhooks page, not the RTC
    // page that happens to say the word once.
    const [first] = rank(INDEX, 'webhook');
    expect(first.record.slug).toBe('server/webhooks');
  });

  it('requires every term to match, so extra words narrow the results', () => {
    expect(rank(INDEX, 'raven login')).toHaveLength(1);
    expect(rank(INDEX, 'raven login webhooks')).toHaveLength(0);
  });

  it('is case-insensitive in both directions', () => {
    expect(rank(INDEX, 'raven_token')).toHaveLength(1);
    expect(rank(INDEX, 'RAVEN_TOKEN')).toHaveLength(1);
  });

  it('matches inside code samples, not only prose', () => {
    // People search for identifiers far more than for the sentences
    // around them.
    expect(rank(INDEX, 'RAVEN_TOKEN')[0].record.slug).toBe('sdk/cli');
  });

  it('matches headings, and keeps the anchor that links to them', () => {
    const [first] = rank(INDEX, 'events');
    expect(first.record.anchor).toBe('events');
  });

  it('boosts an exact multi-word phrase over scattered term matches', () => {
    const withPhrase = rank(
      [
        record({ slug: 'a', title: 'A', text: 'signed webhook delivery' }),
        record({ slug: 'b', title: 'B', text: 'webhook ... something ... delivery' }),
      ],
      'webhook delivery',
    );
    expect(withPhrase[0].record.slug).toBe('a');
  });

  it('produces an excerpt centred on the match, not the start of the section', () => {
    const long = record({
      slug: 'long',
      title: 'Long',
      text: `${'padding '.repeat(40)}needle${' trailing'.repeat(40)}`,
    });
    const [result] = rank([long], 'needle');
    expect(result.excerpt).toContain('needle');
    expect(result.excerpt.startsWith('…')).toBe(true);
    expect(result.excerpt.length).toBeLessThan(long.text.length);
  });

  it('breaks score ties deterministically, so results do not reshuffle', () => {
    const tied = [record({ slug: 'z/page', title: 'Same' }), record({ slug: 'a/page', title: 'Same' })];
    expect(rank(tied, 'same').map((r) => r.record.slug)).toEqual(['a/page', 'z/page']);
  });

  it('caps how many results come back', () => {
    const many = Array.from({ length: 40 }, (_, i) => record({ slug: `p${i}`, title: 'Token page' }));
    expect(rank(many, 'token').length).toBeLessThanOrEqual(12);
  });
});

describe('stem', () => {
  it('closes the plural gap', () => {
    expect(stem('tokens')).toBe('token');
    expect(stem('webhooks')).toBe('webhook');
  });

  it('closes the gerund gap, which is what "screen share" needed', () => {
    // "share" is not a substring of "sharing"; both reduce to "shar".
    expect(stem('share')).toBe(stem('sharing'));
  });

  it('leaves a word alone when stripping would leave too little behind', () => {
    // "mut" would match "mutation" and "mutual": worse than missing
    // "muting".
    expect(stem('mute')).toBe('mute');
    expect(stem('used')).toBe('used');
  });

  it('leaves words with no matching suffix untouched', () => {
    expect(stem('screen')).toBe('screen');
    expect(stem('flutter')).toBe('flutter');
    expect(stem('raven_token')).toBe('raven_token');
  });

  it('is idempotent, so stemming an already-stemmed term is safe', () => {
    for (const word of ['tokens', 'sharing', 'screen', 'codes']) {
      expect(stem(stem(word))).toBe(stem(word));
    }
  });
});

describe('rank — stemming in practice', () => {
  const pages = [
    record({ slug: 'rtc/screen-sharing', title: 'Screen Sharing', text: 'Publish a display surface.' }),
    record({ slug: 'server/tokens', title: 'Tokens', text: 'Mint a token on your server.' }),
  ];

  it('finds a page whose title is the gerund of the query', () => {
    expect(rank(pages, 'screen share')[0].record.slug).toBe('rtc/screen-sharing');
  });

  it('finds a page whose body uses the singular of a plural query', () => {
    expect(rank(pages, 'tokens')[0].record.slug).toBe('server/tokens');
  });
});

describe('queryTerms', () => {
  it('drops the connective words that would break an AND search', () => {
    expect(queryTerms('how do I mute a mic')).toEqual(['mute', 'mic']);
  });

  it('keeps the words when a query is nothing but stopwords', () => {
    // A literal search beats returning nothing at all.
    expect(queryTerms('how to')).toEqual(['how', 'to']);
  });

  it('keeps words that could carry real meaning in a query', () => {
    expect(queryTerms('turn off video')).toEqual(['turn', 'off', 'video']);
  });

  it('stems what survives', () => {
    expect(queryTerms('verifying webhook signatures')).toEqual(['verify', 'webhook', 'signatur']);
  });
});

describe('rank — page description as context', () => {
  const pages = [
    record({
      slug: 'rtc/audio-and-video',
      title: 'Audio & Video',
      description: 'Camera, microphone, and the create-then-publish pattern.',
      heading: 'Muting vs. unpublishing',
      anchor: 'muting-vs-unpublishing',
      text: 'track.mute() stops sending media but keeps the track published.',
    }),
    record({
      slug: 'rtc/screen-sharing',
      title: 'Screen Sharing',
      heading: 'Stopping',
      anchor: 'stopping',
      text: 'Same shape as camera/microphone — see Audio & Video for the mute-vs-unpublish distinction.',
    }),
  ];

  it('lets a page description satisfy a term the section itself lacks', () => {
    // "mic" appears only in the description of the right page, and in
    // the body of the wrong one. Sections are matched independently, so
    // without the description this question lands on Screen Sharing.
    expect(rank(pages, 'mute mic')[0].record.slug).toBe('rtc/audio-and-video');
  });

  it('still lets the section own words outweigh a description match', () => {
    expect(rank(pages, 'screen sharing')[0].record.slug).toBe('rtc/screen-sharing');
  });
});

describe('rank — natural-language queries', () => {
  const pages = [
    record({
      slug: 'rtc/audio-and-video',
      title: 'Audio & Video',
      text: 'Mute the microphone with setMicrophoneEnabled(false).',
    }),
    record({
      slug: 'getting-started/introduction',
      title: 'Introduction',
      text: 'How Livqeno fits together, and what it is for.',
    }),
  ];

  it('answers a question phrased as a question', () => {
    // Without stopword removal this returns nothing: "how" and "mute"
    // are not on the same page.
    expect(rank(pages, 'how do I mute a mic')[0].record.slug).toBe('rtc/audio-and-video');
  });
});

describe('highlight', () => {
  it('splits a string into matched and unmatched runs', () => {
    expect(highlight('Chat tokens', 'token')).toEqual([
      { text: 'Chat ', match: false },
      { text: 'token', match: true },
      { text: 's', match: false },
    ]);
  });

  it('marks every occurrence, not just the first', () => {
    // Asserted as coverage instead of run count, because two
    // occurrences separated only by a space merge into one run: see
    // the gap-bridging test below.
    const marked = highlight('token in a token list', 'token')
      .filter((p) => p.match)
      .map((p) => p.text);
    expect(marked).toEqual(['token', 'token']);
  });

  it('marks each term of a multi-word query independently', () => {
    const marked = highlight('chat and rtc tokens', 'chat rtc').filter((p) => p.match);
    expect(marked.map((p) => p.text)).toEqual(['chat', 'rtc']);
  });

  it('merges adjacent matches into one run instead of fragmenting them', () => {
    // "rtc token" against "rtc tokens" must not emit three separate
    // marks with a bare space between them.
    const parts = highlight('rtc tokens', 'rtc token');
    expect(parts[0]).toEqual({ text: 'rtc token', match: true });
  });

  it('returns the text untouched when the query has nothing to match on', () => {
    expect(highlight('Chat tokens', '')).toEqual([{ text: 'Chat tokens', match: false }]);
    expect(highlight('Chat tokens', 'a')).toEqual([{ text: 'Chat tokens', match: false }]);
  });

  it('does not light up stopwords scattered through an excerpt', () => {
    const marked = highlight('The token is in the response', 'the token').filter((p) => p.match);
    expect(marked.map((p) => p.text)).toEqual(['token']);
  });

  it('never loses or duplicates characters', () => {
    const text = 'Set RAVEN_TOKEN in CI, then run raven login on a laptop.';
    expect(
      highlight(text, 'raven token')
        .map((p) => p.text)
        .join(''),
    ).toBe(text);
  });
});
