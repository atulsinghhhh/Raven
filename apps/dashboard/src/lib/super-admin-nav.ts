/**
 * Super Admin Portal navigation. Deliberately its own file, not an
 * extension of `ACCOUNT_NAV`/`NAV_GROUPS` in `nav.ts` — those describe the
 * developer-facing dashboard, and nothing in this console should share a
 * config object with it (§1/§2 of the spec: this is a separate console,
 * not a section of the normal dashboard).
 */
export interface SuperAdminNavItem {
  href: string;
  label: string;
  icon:
    | 'overview'
    | 'developers'
    | 'activity'
    | 'audit'
    | 'rtc'
    | 'chat'
    | 'live'
    | 'api'
    | 'usage'
    | 'errors'
    | 'security'
    | 'infrastructure'
    | 'admins'
    | 'settings';
  exact?: boolean;
}

export interface SuperAdminNavGroup {
  label?: string;
  items: SuperAdminNavItem[];
}

export const SUPER_ADMIN_NAV_GROUPS: SuperAdminNavGroup[] = [
  {
    items: [{ href: '/super-admin', label: 'Overview', icon: 'overview', exact: true }],
  },
  {
    label: 'Platform',
    items: [
      { href: '/super-admin/developers', label: 'Developers', icon: 'developers' },
      { href: '/super-admin/activity', label: 'Activity', icon: 'activity' },
      { href: '/super-admin/audit-logs', label: 'Audit Logs', icon: 'audit' },
    ],
  },
  {
    label: 'Products',
    items: [
      { href: '/super-admin/rtc', label: 'RTC', icon: 'rtc' },
      { href: '/super-admin/chat', label: 'Chat', icon: 'chat' },
      { href: '/super-admin/live', label: 'Live Streaming', icon: 'live' },
      { href: '/super-admin/api', label: 'API', icon: 'api' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/super-admin/usage', label: 'Usage', icon: 'usage' },
      { href: '/super-admin/errors', label: 'Errors', icon: 'errors' },
      { href: '/super-admin/security', label: 'Security', icon: 'security' },
      { href: '/super-admin/infrastructure', label: 'Infrastructure', icon: 'infrastructure' },
    ],
  },
  {
    label: 'Console',
    items: [
      { href: '/super-admin/admins', label: 'Admins', icon: 'admins' },
      { href: '/super-admin/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];
