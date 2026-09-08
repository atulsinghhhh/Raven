/**
 * Project-scoped navigation. Grouped by what a developer is trying to do
 *, run RTC, debug it, integrate against it, instead of mirroring the
 * API's controller layout.
 *
 * Nothing here links to a surface the Control API can't actually back;
 * a nav entry for a non-existent feature is a lie. Webhooks appear as of
 * Phase 12, when the endpoints behind them started existing.
 */
export interface NavItem {
  slug: string;
  label: string;
  icon:
    | 'overview'
    | 'rooms'
    | 'connections'
    | 'participants'
    | 'metrics'
    | 'errors'
    | 'diagnostics'
    | 'keys'
    | 'sdk'
    | 'quickstart'
    | 'usage'
    | 'settings'
    | 'chat'
    | 'conversations'
    | 'presence'
    | 'live-streaming'
    | 'streams'
    | 'webhooks'
    | 'members'
    | 'audit'
    | 'effects'
    | 'cli'
    | 'analytics'
    | 'logs'
    | 'events';
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * The top-level sidebar is intentionally flat: one entry per product,
 * not one per resource. Rooms/Connections/Participants (RTC),
 * Conversations/Connections (Chat), and Streams (Live Streaming) still
 * exist exactly as before; they're reached via the ProductTabs bar each
 * product's own pages render (see components/shell/product-tabs.tsx),
 * not from this global list. Nothing here links to a surface the
 * Control API can't actually back: a nav entry for a non-existent
 * feature is a lie.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ slug: 'overview', label: 'Overview', icon: 'overview' }],
  },
  {
    label: 'Products',
    items: [
      { slug: 'rooms', label: 'RTC', icon: 'rooms' },
      { slug: 'chat', label: 'Chat', icon: 'chat' },
      { slug: 'live-streaming', label: 'Live Streaming', icon: 'live-streaming' },
      { slug: 'effects', label: 'Effects', icon: 'effects' },
    ],
  },
  {
    label: 'Developers',
    items: [
      { slug: 'api-keys', label: 'API Keys', icon: 'keys' },
      { slug: 'sdks', label: 'SDKs', icon: 'sdk' },
      { slug: 'webhooks', label: 'Webhooks', icon: 'webhooks' },
      { slug: 'cli', label: 'CLI', icon: 'cli' },
    ],
  },
  {
    label: 'Observability',
    items: [
      { slug: 'analytics', label: 'Analytics', icon: 'analytics' },
      { slug: 'logs', label: 'Logs', icon: 'logs' },
      { slug: 'events', label: 'Events', icon: 'events' },
    ],
  },
  {
    label: 'Project',
    items: [
      { slug: 'members', label: 'Members', icon: 'members' },
      { slug: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

/**
 * The documentation site (apps/docs). Overridable so a self-hosted
 * deployment can point at its own copy, not a URL it doesn't
 * control.
 */
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3200';
