import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every doc page is statically rendered from Markdown at build time;
  // no server actions, no image domains, nothing beyond what Next gives
  // for free.

  // `next dev` otherwise regenerates AGENTS.md/CLAUDE.md on every run;
  // noise unrelated to this app, and apps/dashboard doesn't carry them either.
  agentRules: false,

  // Slugs renamed during the product-scoped IA redesign: every one of
  // these was a real, linkable page before, so an old bookmark or an
  // external link into a page still resolves instead of 404ing.
  async redirects() {
    return [
      { source: '/rtc/overview', destination: '/rtc', permanent: true },
      { source: '/chat/overview', destination: '/chat', permanent: true },
      { source: '/live-streaming/overview', destination: '/live-streaming', permanent: true },
      { source: '/getting-started/authentication', destination: '/authentication', permanent: true },
      { source: '/getting-started/build-a-video-call', destination: '/guides/build-a-video-call', permanent: true },
      { source: '/server/webhooks', destination: '/webhooks', permanent: true },
      { source: '/server/rest-api', destination: '/api-reference', permanent: true },
      { source: '/server/tokens', destination: '/authentication/tokens', permanent: true },
      { source: '/sdk/cli', destination: '/cli', permanent: true },
    ];
  },
};

export default nextConfig;
