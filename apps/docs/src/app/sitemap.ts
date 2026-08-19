import type { MetadataRoute } from 'next';
import { getAllSlugs } from '../lib/docs';
import { SITE_URL } from '../lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = getAllSlugs().map((slug) => ({
    url: `${SITE_URL}/${slug}`,
    changeFrequency: 'weekly' as const,
  }));

  return [{ url: SITE_URL, changeFrequency: 'weekly' as const, priority: 1 }, ...pages];
}
