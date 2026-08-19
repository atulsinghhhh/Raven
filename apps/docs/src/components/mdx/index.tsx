import type { MDXRemoteProps } from 'next-mdx-remote';
import { Pre } from './CodeBlock';
import { Tab, Tabs } from './Tabs';

/** What a reader's browser gets — `getDoc`'s search-index rendering pass uses a separate, React-free pipeline (see `lib/docs.ts`). */
export const mdxComponents: NonNullable<MDXRemoteProps['components']> = {
  pre: Pre,
  Tabs,
  Tab,
};
