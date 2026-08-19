/**
 * Project-scoped navigation. Grouped by what a developer is trying to do
 * — run RTC, debug it, integrate against it — rather than mirroring the
 * API's controller layout.
 *
 * Nothing here links to a surface the Control API can't actually back —
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
    | 'webhooks'
    | 'members'
    | 'audit';
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ slug: 'overview', label: 'Overview', icon: 'overview' }],
  },
  {
    label: 'RTC',
    items: [
      { slug: 'rooms', label: 'Rooms', icon: 'rooms' },
      { slug: 'connections', label: 'Connections', icon: 'connections' },
      { slug: 'participants', label: 'Participants', icon: 'participants' },
    ],
  },
  {
    // Chat is its own group, not a sub-item of RTC. They're separate
    // services with separate connections — folding one into the other in
    // the nav would misrepresent the architecture.
    label: 'Chat',
    items: [
      { slug: 'chat', label: 'Overview', icon: 'chat' },
      { slug: 'chat/conversations', label: 'Conversations', icon: 'conversations' },
      { slug: 'chat/connections', label: 'Connections', icon: 'connections' },
      { slug: 'webhooks', label: 'Webhooks', icon: 'webhooks' },
    ],
  },
  {
    label: 'Observability',
    items: [
      { slug: 'metrics', label: 'Metrics', icon: 'metrics' },
      { slug: 'errors', label: 'Errors', icon: 'errors' },
      { slug: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics' },
    ],
  },
  {
    label: 'Developers',
    items: [
      { slug: 'quickstart', label: 'Quickstart', icon: 'quickstart' },
      { slug: 'api-keys', label: 'API Keys', icon: 'keys' },
      { slug: 'sdks', label: 'SDKs', icon: 'sdk' },
    ],
  },
  {
    label: 'Project',
    items: [
      { slug: 'usage', label: 'Usage', icon: 'usage' },
      { slug: 'members', label: 'Members', icon: 'members' },
      { slug: 'audit', label: 'Audit log', icon: 'audit' },
      { slug: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

/**
 * The documentation site (apps/docs). Overridable so a self-hosted
 * deployment can point at its own copy rather than a URL it doesn't
 * control.
 */
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3200';
