/**
 * Project-scoped navigation. Grouped by what a developer is trying to do
 * — run RTC, debug it, integrate against it — rather than mirroring the
 * API's controller layout.
 *
 * Nothing here links to a surface the Control API can't actually back.
 * Webhooks in particular are deliberately absent: there's no webhook
 * endpoint yet, and a nav entry for a non-existent feature is a lie.
 */
export interface NavItem {
  slug: string;
  label: string;
  icon: 'overview' | 'rooms' | 'connections' | 'participants' | 'metrics' | 'errors' | 'diagnostics' | 'keys' | 'sdk' | 'quickstart' | 'usage' | 'settings';
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
      { slug: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

export const DOCS_URL = 'https://github.com/atulsinghhhh/Raven/tree/main/docs';
