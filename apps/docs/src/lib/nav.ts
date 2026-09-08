/**
 * The documentation's table of contents, in the order it should read;
 * not inferred from the filesystem, so a section can be reordered or a
 * page added without renaming files or fighting alphabetical sort.
 *
 * A slug not listed here still renders (any file under content/ is
 * reachable by its path), it just won't appear in the sidebar. Nothing
 * here links to a slug that doesn't have a corresponding .md file;
 * `pnpm typecheck`-equivalent for content is `getNav()`'s own
 * `assertNavMatchesContent` check, run at build time.
 *
 * RTC, Chat, and Live Streaming are tagged with `product`: that tag is
 * what makes the sidebar context-aware (Sidebar.tsx renders only the
 * matching section under `/rtc/*`, `/chat/*`, `/live-streaming/*`) and
 * what drives the product switcher (ProductSwitcher.tsx). Every other
 * section is untagged and stays in the site's general/global nav.
 */
export type ProductId = 'rtc' | 'chat' | 'live-streaming';

export interface NavItem {
  slug: string;
  title: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  /** Set only on the three product sections: see file header. */
  product?: ProductId;
}

/**
 * The three products, in the order the switcher and homepage show them.
 * Each product's landing page lives at the bare product slug (`rtc`,
 * not `rtc/overview`): see `content/rtc.md` etc.
 */
export const PRODUCTS: { id: ProductId; label: string; slug: string }[] = [
  { id: 'rtc', label: 'RTC', slug: 'rtc' },
  { id: 'chat', label: 'Chat', slug: 'chat' },
  { id: 'live-streaming', label: 'Live Streaming', slug: 'live-streaming' },
];

export const NAV: NavSection[] = [
  {
    title: 'Getting Started',
    items: [
      { slug: 'getting-started/introduction', title: 'Introduction' },
      { slug: 'getting-started/architecture', title: 'Architecture' },
      { slug: 'getting-started/quickstart', title: 'Quickstart' },
      { slug: 'getting-started/installing-from-source', title: 'Installing from source' },
    ],
  },
  {
    title: 'RTC',
    product: 'rtc',
    items: [
      { slug: 'rtc', title: 'Overview' },
      { slug: 'rtc/quickstart', title: 'Quickstart' },
      { slug: 'rtc/authentication', title: 'Authentication' },
      { slug: 'rtc/rooms-and-participants', title: 'Rooms & Participants' },
      { slug: 'rtc/audio-and-video', title: 'Audio & Video' },
      { slug: 'rtc/screen-sharing', title: 'Screen Sharing' },
      { slug: 'rtc/permissions', title: 'Permissions' },
      { slug: 'rtc/background-audio', title: 'Background Audio' },
      { slug: 'rtc/reconnection', title: 'Reconnection & Network Quality' },
      { slug: 'rtc/diagnostics', title: 'Diagnostics' },
      { slug: 'rtc/troubleshooting', title: 'Troubleshooting' },
    ],
  },
  {
    title: 'Chat',
    product: 'chat',
    items: [
      { slug: 'chat', title: 'Overview' },
      { slug: 'chat/quickstart', title: 'Quickstart' },
      { slug: 'chat/authentication', title: 'Authentication' },
      { slug: 'chat/conversations', title: 'Conversations' },
      { slug: 'chat/members', title: 'Members' },
      { slug: 'chat/messages', title: 'Messages' },
      { slug: 'chat/message-history', title: 'Message History' },
      { slug: 'chat/threads', title: 'Threads' },
      { slug: 'chat/presence', title: 'Presence' },
      { slug: 'chat/typing', title: 'Typing Indicators' },
      { slug: 'chat/reactions', title: 'Reactions' },
      { slug: 'chat/read-receipts', title: 'Delivery & Read Receipts' },
      { slug: 'chat/attachments', title: 'Attachments' },
      { slug: 'chat/moderation', title: 'Moderation' },
      { slug: 'chat/websocket', title: 'WebSocket Protocol' },
      { slug: 'chat/troubleshooting', title: 'Troubleshooting' },
    ],
  },
  {
    title: 'Live Streaming',
    product: 'live-streaming',
    items: [
      { slug: 'live-streaming', title: 'Overview' },
      { slug: 'live-streaming/quickstart', title: 'Quickstart' },
      { slug: 'live-streaming/authentication', title: 'Authentication' },
      { slug: 'live-streaming/streams', title: 'Streams & Lifecycle' },
      { slug: 'live-streaming/hosts', title: 'Hosts & Co-hosts' },
      { slug: 'live-streaming/viewers', title: 'Viewers' },
      { slug: 'live-streaming/live-chat', title: 'Live Chat' },
      { slug: 'live-streaming/reactions', title: 'Reactions' },
      { slug: 'live-streaming/moderation', title: 'Moderation' },
      { slug: 'live-streaming/filters', title: 'Filters & Effects' },
      { slug: 'live-streaming/network-quality', title: 'Network Quality' },
      { slug: 'live-streaming/analytics', title: 'Analytics' },
      { slug: 'live-streaming/sdk-support', title: 'SDK Support Matrix' },
    ],
  },
  {
    title: 'Effects',
    items: [
      { slug: 'effects', title: 'Overview' },
      { slug: 'effects/quickstart', title: 'Quickstart' },
      { slug: 'effects/filters', title: 'Filters' },
      { slug: 'effects/presets', title: 'Presets' },
      { slug: 'effects/pipeline', title: 'Pipeline' },
      { slug: 'effects/rtc-integration', title: 'RTC Integration' },
      { slug: 'effects/live-streaming', title: 'Live Streaming Integration' },
      { slug: 'effects/react', title: 'React' },
      { slug: 'effects/react-native', title: 'React Native' },
      { slug: 'effects/flutter', title: 'Flutter' },
      { slug: 'effects/performance', title: 'Performance' },
      { slug: 'effects/troubleshooting', title: 'Troubleshooting' },
      { slug: 'effects/api-reference', title: 'API Reference' },
    ],
  },
  {
    title: 'SDKs',
    items: [
      { slug: 'sdk/web', title: 'TypeScript / Web' },
      { slug: 'sdk/react', title: 'React' },
      { slug: 'sdk/react-native', title: 'React Native' },
      { slug: 'sdk/flutter', title: 'Flutter' },
      { slug: 'sdk/node', title: 'Node.js' },
      { slug: 'sdk/python', title: 'Python' },
    ],
  },
  {
    title: 'Webhooks',
    items: [{ slug: 'webhooks', title: 'Overview' }],
  },
  {
    title: 'Authentication',
    items: [
      { slug: 'authentication', title: 'Overview' },
      { slug: 'authentication/tokens', title: 'Tokens' },
    ],
  },
  {
    title: 'API Reference',
    items: [{ slug: 'api-reference', title: 'Overview' }],
  },
  {
    title: 'CLI',
    items: [{ slug: 'cli', title: 'Overview' }],
  },
  {
    title: 'Guides',
    items: [{ slug: 'guides/build-a-video-call', title: 'Build a Video Call' }],
  },
  {
    title: 'Examples',
    items: [{ slug: 'examples', title: 'Overview' }],
  },
  {
    title: 'Troubleshooting',
    items: [{ slug: 'troubleshooting', title: 'Overview' }],
  },
  {
    title: 'Production',
    items: [
      { slug: 'production/environments', title: 'Environments' },
      { slug: 'production/roles-and-permissions', title: 'Roles & Permissions' },
      { slug: 'production/audit-logs', title: 'Audit Logs' },
      { slug: 'production/rate-limits', title: 'Rate Limits' },
      { slug: 'production/security', title: 'Security' },
      { slug: 'production/observability', title: 'Observability' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { slug: 'reference/errors', title: 'Error Codes' },
      { slug: 'reference/events', title: 'Event Catalogue' },
    ],
  },
];

export function findNavItem(slug: string): { section: NavSection; item: NavItem } | undefined {
  for (const section of NAV) {
    const item = section.items.find((i) => i.slug === slug);
    if (item) return { section, item };
  }
  return undefined;
}

/** Which product's docs area a slug belongs to, if any: drives the context-aware sidebar. */
export function productForSlug(slug: string): ProductId | undefined {
  return findNavItem(slug)?.section.product;
}

/** The previous/next page in reading order, for the footer nav on every doc page. */
export function getAdjacent(slug: string): { prev?: NavItem; next?: NavItem } {
  const flat = NAV.flatMap((s) => s.items);
  const index = flat.findIndex((i) => i.slug === slug);
  if (index === -1) return {};
  return { prev: flat[index - 1], next: flat[index + 1] };
}
