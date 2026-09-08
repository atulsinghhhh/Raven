/**
 * The docs site's own public URL: same env-var convention DocsNav
 * already uses for the marketing/dashboard URLs, falling back to the
 * local dev port (see package.json's `dev` script).
 */
export const SITE_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3200';
