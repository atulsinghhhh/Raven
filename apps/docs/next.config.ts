import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every doc page is statically rendered from Markdown at build time —
  // no server actions, no image domains, nothing beyond what Next gives
  // for free.

  // `next dev` otherwise regenerates AGENTS.md/CLAUDE.md on every run —
  // noise unrelated to this app, and apps/dashboard doesn't carry them either.
  agentRules: false,
};

export default nextConfig;
