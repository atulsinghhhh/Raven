/**
 * External links shown in the nav/footer. Centralized so the same URL
 * doesn't drift between the two places it's rendered.
 */
// The repository, now the landing page's one community link in place of a
// Discord invite.
//
// IT 404s FOR EVERYONE UNTIL THE REPO IS MADE PUBLIC. `atulsinghhhh/Raven`
// is private today — an anonymous GET returns 404, which is how GitHub
// hides a private repo rather than admitting it exists. The note that used
// to stand here said a repo link was impossible for exactly this reason and
// it was right; the link is wired up because it was asked for and because
// the repo going public is one setting away, not because it resolves now.
//
// Two other places disagree about this and one of them is wrong: the README
// calls Raven "open-source", docs/production/readiness-audit.md calls it
// closed-source. The repo setting is the tiebreak, and it currently says
// closed.
export const GITHUB_REPO_URL = 'https://github.com/atulsinghhhh/Raven';

/**
 * Direct WhatsApp chat, shown in the footer's Community column.
 *
 * `wa.me` wants the full international number with no `+`, no spaces and
 * no leading zero, so the country code is part of the string rather than
 * something the link builds: 91 is India.
 */
export const WHATSAPP_NUMBER = '918624834271';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

/** Where the dashboard actually lives: a separate app in this monorepo (apps/dashboard). */
export const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000';
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3200';

/**
 * Doc routes referenced from more than one section. Every slug here has
 * a real page in apps/docs/content (see docs/src/lib/nav.ts): no
 * placeholders for pages that don't exist yet.
 */
export const DOCS_ROUTES = {
  rtc: `${DOCS_URL}/rtc`,
  rtcAuthentication: `${DOCS_URL}/rtc/authentication`,
  rtcReconnection: `${DOCS_URL}/rtc/reconnection`,
  rtcDiagnostics: `${DOCS_URL}/rtc/diagnostics`,
  chat: `${DOCS_URL}/chat`,
  liveStreaming: `${DOCS_URL}/live-streaming`,
  effects: `${DOCS_URL}/effects`,
  effectsQuickstart: `${DOCS_URL}/effects/quickstart`,
  environments: `${DOCS_URL}/production/environments`,
  auditLogs: `${DOCS_URL}/production/audit-logs`,
  sdkWeb: `${DOCS_URL}/sdk/web`,
  sdkReact: `${DOCS_URL}/sdk/react`,
  sdkReactNative: `${DOCS_URL}/sdk/react-native`,
  sdkFlutter: `${DOCS_URL}/sdk/flutter`,
  sdkNode: `${DOCS_URL}/sdk/node`,
  sdkPython: `${DOCS_URL}/sdk/python`,
  cli: `${DOCS_URL}/cli`,
  apiReference: `${DOCS_URL}/api-reference`,
  examples: `${DOCS_URL}/examples`,
  webhooks: `${DOCS_URL}/webhooks`,
  quickstart: `${DOCS_URL}/getting-started/quickstart`,
  installingFromSource: `${DOCS_URL}/getting-started/installing-from-source`,
} as const;
