/**
 * The documentation's table of contents, in the order it should read.
 *
 * Not inferred from the filesystem, so a section can be reordered or a page
 * inserted without renaming files or fighting alphabetical sort. Two checks
 * keep it honest: `assertNavMatchesContent()` runs at build time and refuses a
 * sidebar link with no content file, and `scripts/verify-docs.mjs` refuses a
 * content file no sidebar link reaches. Neither direction is allowed to rot.
 *
 * The four products — RTC, Chat, Live Streaming, Effects — carry a `product`
 * tag. That tag makes the sidebar context-aware (Sidebar.tsx renders only the
 * matching section under `/rtc/*`, `/chat/*`, `/live-streaming/*`,
 * `/effects/*`) and drives the product switcher. Every other section is
 * untagged and stays in the global nav.
 *
 * Section order follows the path a developer actually takes: understand, get
 * running, then whichever product they came for, then the reference material
 * they return to. Self-hosting sits near the end because most readers are on a
 * hosted deployment, and Resources last because it is looked up rather than
 * read through.
 */
export type ProductId = 'rtc' | 'chat' | 'live-streaming' | 'effects';

export interface NavItem {
  slug: string;
  title: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  /** Set only on the four product sections: see file header. */
  product?: ProductId;
}

/**
 * The products, in the order the switcher and the homepage show them.
 *
 * Each product's landing page lives at the bare product slug (`rtc`, not
 * `rtc/overview`): see `content/rtc.md` and siblings.
 *
 * Effects is here because it is a product by every test that matters — its own
 * package, its own error vocabulary, its own platform integrations — even
 * though it runs entirely client-side and needs no Raven credential.
 */
export const PRODUCTS: { id: ProductId; label: string; slug: string }[] = [
  { id: 'rtc', label: 'RTC', slug: 'rtc' },
  { id: 'chat', label: 'Chat', slug: 'chat' },
  { id: 'live-streaming', label: 'Live Streaming', slug: 'live-streaming' },
  { id: 'effects', label: 'Effects', slug: 'effects' },
];

export const NAV: NavSection[] = [
  {
    title: 'Introduction',
    items: [
      { slug: 'getting-started/introduction', title: 'What is Raven?' },
      { slug: 'getting-started/architecture', title: 'Architecture' },
      { slug: 'getting-started/quickstart', title: 'Quickstart' },
    ],
  },
  {
    title: 'Get Started',
    items: [
      { slug: 'get-started/create-a-project', title: 'Create a project' },
      { slug: 'get-started/api-credentials', title: 'API credentials' },
      { slug: 'get-started/install-an-sdk', title: 'Install an SDK' },
      { slug: 'get-started/first-token', title: 'Generate a token' },
      { slug: 'get-started/first-room', title: 'Join your first room' },
      { slug: 'getting-started/installing-from-source', title: 'Installing from source' },
    ],
  },
  {
    title: 'Concepts',
    items: [
      { slug: 'concepts', title: 'Overview' },
      { slug: 'concepts/project', title: 'Project' },
      { slug: 'concepts/environment', title: 'Environment' },
      { slug: 'concepts/api-key', title: 'API key' },
      { slug: 'concepts/token', title: 'Token' },
      { slug: 'concepts/room', title: 'Room' },
      { slug: 'concepts/participant', title: 'Participant' },
      { slug: 'concepts/track', title: 'Track' },
      { slug: 'concepts/connection', title: 'Connection' },
      { slug: 'concepts/usage', title: 'Usage' },
      { slug: 'concepts/conversation', title: 'Conversation' },
      { slug: 'concepts/message', title: 'Message' },
      { slug: 'concepts/live-stream', title: 'Live stream' },
      { slug: 'concepts/event', title: 'Event' },
      { slug: 'concepts/webhook', title: 'Webhook' },
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
      { slug: 'rtc/tracks', title: 'Tracks & Publishing' },
      { slug: 'rtc/screen-sharing', title: 'Screen Sharing' },
      { slug: 'rtc/permissions', title: 'Permissions' },
      { slug: 'rtc/background-audio', title: 'Background Audio' },
      { slug: 'rtc/reconnection', title: 'Reconnection & Network Quality' },
      { slug: 'rtc/diagnostics', title: 'Diagnostics' },
      { slug: 'rtc/events', title: 'Events' },
      { slug: 'rtc/signaling-protocol', title: 'Signaling Protocol' },
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
      { slug: 'chat/events', title: 'Events' },
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
      { slug: 'live-streaming/events', title: 'Stream Events' },
      { slug: 'live-streaming/sdk-support', title: 'SDK Support Matrix' },
    ],
  },
  {
    title: 'Effects',
    product: 'effects',
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
      { slug: 'sdk', title: 'Overview' },
      { slug: 'sdk/web', title: 'Web' },
      { slug: 'sdk/client', title: 'Raven Client' },
      { slug: 'sdk/react', title: 'React' },
      { slug: 'sdk/react-native', title: 'React Native' },
      { slug: 'sdk/flutter', title: 'Flutter' },
      { slug: 'sdk/node', title: 'Node.js' },
      { slug: 'sdk/python', title: 'Python' },
      { slug: 'sdk/cli', title: 'CLI' },
      { slug: 'sdk/browser-support', title: 'Browser Support' },
    ],
  },
  {
    title: 'Backend',
    items: [
      { slug: 'authentication', title: 'Authentication' },
      { slug: 'authentication/api-keys', title: 'API keys' },
      { slug: 'authentication/tokens', title: 'Access tokens' },
      { slug: 'authentication/permissions', title: 'Permissions' },
      { slug: 'authentication/security', title: 'Security' },
      { slug: 'authentication/browser-security', title: 'Browser security & CORS' },
      { slug: 'webhooks', title: 'Webhooks' },
      { slug: 'backend/idempotency', title: 'Idempotency' },
      { slug: 'backend/telemetry', title: 'Telemetry & privacy' },
    ],
  },
  {
    title: 'Guides',
    items: [
      { slug: 'guides', title: 'Overview' },
      { slug: 'guides/build-a-video-call', title: 'Build a video call' },
      { slug: 'guides/build-a-group-call', title: 'Build a group call' },
      { slug: 'guides/build-a-chat-application', title: 'Build a chat application' },
      { slug: 'guides/build-a-live-stream', title: 'Build a live stream' },
      { slug: 'guides/add-screen-sharing', title: 'Add screen sharing' },
      { slug: 'guides/handle-reconnection', title: 'Handle reconnection' },
      { slug: 'guides/handle-webhooks', title: 'Handle webhooks' },
      { slug: 'guides/build-for-production', title: 'Build for production' },
      { slug: 'guides/migrate-from-livekit', title: 'Migrate from LiveKit' },
    ],
  },
  {
    title: 'API Reference',
    items: [
      { slug: 'api', title: 'Overview' },
      { slug: 'api/conventions', title: 'Conventions' },
      { slug: 'api/auth', title: 'Auth & Account' },
      { slug: 'api/projects', title: 'Projects, Members & Keys' },
      { slug: 'api/rtc', title: 'RTC' },
      { slug: 'api/chat', title: 'Chat' },
      { slug: 'api/live-streams', title: 'Live Streaming' },
      { slug: 'api/observability', title: 'Observability' },
      { slug: 'api/webhooks', title: 'Webhooks' },
      { slug: 'api/all-endpoints', title: 'All endpoints' },
    ],
  },
  {
    title: 'Self-hosting',
    items: [
      { slug: 'self-hosting', title: 'Overview' },
      { slug: 'self-hosting/docker-compose', title: 'Docker Compose' },
      { slug: 'self-hosting/environment-variables', title: 'Environment variables' },
      { slug: 'self-hosting/turn', title: 'TURN & NAT traversal' },
      { slug: 'self-hosting/sfu', title: 'Running the SFU' },
      { slug: 'self-hosting/health-and-metrics', title: 'Health & metrics' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { slug: 'reference/errors', title: 'Errors' },
      { slug: 'reference/events', title: 'Event catalogue' },
      { slug: 'reference/limits', title: 'Limits & quotas' },
      { slug: 'production/environments', title: 'Environments' },
      { slug: 'production/roles-and-permissions', title: 'Roles & permissions' },
      { slug: 'production/audit-logs', title: 'Audit logs' },
      { slug: 'production/rate-limits', title: 'Rate limits' },
      { slug: 'production/security', title: 'Security' },
      { slug: 'production/observability', title: 'Observability' },
      { slug: 'production/checklist', title: 'Production checklist' },
      { slug: 'troubleshooting', title: 'Troubleshooting' },
      { slug: 'examples', title: 'Examples' },
      { slug: 'reference/known-limitations', title: 'Known limitations' },
      { slug: 'reference/changelog', title: 'Changelog' },
      { slug: 'reference/faq', title: 'FAQ' },
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
