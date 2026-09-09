import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every doc page is statically rendered from Markdown at build time;
  // no server actions, no image domains, nothing beyond what Next gives
  // for free.

  // `next dev` otherwise regenerates AGENTS.md/CLAUDE.md on every run;
  // noise unrelated to this app, and apps/dashboard doesn't carry them either.
  agentRules: false,

  // Slugs renamed across the IA redesigns: every one of these was a real,
  // linkable page before, so an old bookmark or an external link still
  // resolves instead of 404ing.
  //
  // A redirect whose `source` is also a live page makes that page
  // unreachable, and one whose `destination` no longer exists sends readers
  // to a 404. Both happened here — `/sdk/cli` pointed the live path at the
  // dead one after the CLI page moved *into* /sdk, and `/server/rest-api`
  // still aimed at `/api-reference` after it was replaced by `/api`.
  // `scripts/verify-docs.mjs` now checks this list against the content tree
  // so neither can recur.
  async redirects() {
    return [
      { source: '/rtc/overview', destination: '/rtc', permanent: true },
      { source: '/chat/overview', destination: '/chat', permanent: true },
      { source: '/live-streaming/overview', destination: '/live-streaming', permanent: true },
      { source: '/getting-started/authentication', destination: '/authentication', permanent: true },
      { source: '/getting-started/build-a-video-call', destination: '/guides/build-a-video-call', permanent: true },
      { source: '/server/webhooks', destination: '/webhooks', permanent: true },
      { source: '/server/rest-api', destination: '/api', permanent: true },
      { source: '/server/tokens', destination: '/authentication/tokens', permanent: true },

      // The CLI page moved from /cli into the SDKs section.
      { source: '/cli', destination: '/sdk/cli', permanent: true },

      // /api-reference was one hand-maintained page; it is now the generated
      // /api/* set, with /api as the entry point.
      { source: '/api-reference', destination: '/api', permanent: true },
    ];
  },
};

export default nextConfig;
