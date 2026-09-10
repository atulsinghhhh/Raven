/**
 * External links shown in the nav/footer. Centralized so the same URL
 * doesn't drift between the two places it's rendered.
 */
// No public GitHub link for the *repository*: Livqeno is closed-source
// infrastructure, not an open repository: see
// docs/production/readiness-audit.md's closed-source note. Community
// support still goes through Discord. (DEVELOPER_GITHUB_URL below is a
// personal profile, not the Livqeno repo — no conflict with that note.)
export const DISCORD_URL = 'https://discord.com/invite/HSWd9qMC7';

/**
 * Direct WhatsApp chat, shown in the footer's Community column.
 *
 * `wa.me` wants the full international number with no `+`, no spaces and
 * no leading zero, so the country code is part of the string rather than
 * something the link builds: 91 is India.
 */
export const WHATSAPP_NUMBER = '918624834271';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

/** The developer behind Livqeno — credited in BuiltBy.tsx and the footer. */
export const DEVELOPER_NAME = 'Atul';
export const DEVELOPER_GITHUB_URL = 'https://github.com/atulsinghhhh/';
export const DEVELOPER_X_URL = 'https://x.com/unfav_atul';

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
