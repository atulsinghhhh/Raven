/**
 * The documentation's table of contents, in the order it should read —
 * not inferred from the filesystem, so a section can be reordered or a
 * page added without renaming files or fighting alphabetical sort.
 *
 * A slug not listed here still renders (any file under content/ is
 * reachable by its path), it just won't appear in the sidebar. Nothing
 * here links to a slug that doesn't have a corresponding .md file —
 * `pnpm typecheck`-equivalent for content is `getNav()`'s own
 * `assertNavMatchesContent` check, run at build time.
 */
export interface NavItem {
  slug: string;
  title: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: 'Getting Started',
    items: [
      { slug: 'getting-started/introduction', title: 'Introduction' },
      { slug: 'getting-started/architecture', title: 'Architecture' },
      { slug: 'getting-started/quickstart', title: 'Quickstart' },
      { slug: 'getting-started/installing-from-source', title: 'Installing from source' },
      { slug: 'getting-started/build-a-video-call', title: 'Tutorial: build a video call' },
      { slug: 'getting-started/authentication', title: 'Authentication' },
    ],
  },
  {
    title: 'RTC',
    items: [
      { slug: 'rtc/overview', title: 'Overview' },
      { slug: 'rtc/rooms-and-participants', title: 'Rooms & Participants' },
      { slug: 'rtc/audio-and-video', title: 'Audio & Video' },
      { slug: 'rtc/screen-sharing', title: 'Screen Sharing' },
      { slug: 'rtc/reconnection', title: 'Reconnection & Network Quality' },
      { slug: 'rtc/diagnostics', title: 'Diagnostics' },
      { slug: 'rtc/troubleshooting', title: 'Troubleshooting' },
    ],
  },
  {
    title: 'Chat',
    items: [
      { slug: 'chat/overview', title: 'Overview' },
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
      { slug: 'chat/websocket', title: 'WebSocket Protocol' },
    ],
  },
  {
    title: 'Live Streaming',
    items: [
      { slug: 'live-streaming/overview', title: 'Overview' },
      { slug: 'live-streaming/quickstart', title: 'Quickstart' },
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
      { slug: 'sdk/cli', title: 'CLI' },
    ],
  },
  {
    title: 'Server',
    items: [
      { slug: 'server/rest-api', title: 'REST API' },
      { slug: 'server/tokens', title: 'Tokens' },
      { slug: 'server/webhooks', title: 'Webhooks' },
    ],
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

/** The previous/next page in reading order, for the footer nav on every doc page. */
export function getAdjacent(slug: string): { prev?: NavItem; next?: NavItem } {
  const flat = NAV.flatMap((s) => s.items);
  const index = flat.findIndex((i) => i.slug === slug);
  if (index === -1) return {};
  return { prev: flat[index - 1], next: flat[index + 1] };
}
