/**
 * External links shown in the nav/footer. Centralized so the same URL
 * doesn't drift between the two places it's rendered.
 */
// No public GitHub link: Raven is closed-source infrastructure, not an
// open repository — see docs/production/readiness-audit.md's closed-source
// note. Community support still goes through Discord.
export const DISCORD_URL = 'https://discord.com/invite/HSWd9qMC7';

/** Where the dashboard actually lives — a separate app in this monorepo (apps/dashboard). */
export const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000';
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3200';
