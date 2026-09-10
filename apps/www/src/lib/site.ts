/**
 * The marketing site's own public URL, used for `metadataBase` and the
 * canonical link. Same env-var convention `links.ts` uses for the
 * dashboard and docs URLs.
 *
 * The fallback is the **currently live** apex, not `livqeno.com`: DNS for
 * the new domain isn't cut over yet, and a canonical pointing at a host
 * that doesn't resolve is worse than a stale one. Set
 * `NEXT_PUBLIC_SITE_URL=https://livqeno.com` on the Vercel project as part
 * of the cutover — see `docs/deployment/livqeno-domain-cutover.md`.
 *
 * Deliberately unlike the localhost fallbacks in `links.ts`: those only
 * affect where a link points during local dev, whereas this one lands in
 * `<link rel=canonical>` on the deployed page, where a localhost value
 * would be actively harmful.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ravenstack.online';
