import { Capability, can, createPermissionChecker } from '@/lib/permissions';

// Fixtures mirror the CAPABILITIES table in
// apps/api/src/modules/projects/project-permissions.ts exactly, as of
// writing — not re-implementing the role → capability mapping (that stays
// server-only), just pinning what the API actually sends for each real
// role so these tests check `can()` against real response shapes instead
// of invented ones. If the backend table changes, these fixtures — and the
// dashboard behavior they describe — need updating too.
const OWNER_CAPS = Object.values(Capability);

const ADMIN_CAPS = [
  Capability.ProjectRead,
  Capability.ProjectWrite,
  Capability.MembersRead,
  Capability.MembersManage,
  Capability.KeysRead,
  Capability.KeysManage,
  Capability.WebhooksRead,
  Capability.WebhooksManage,
  Capability.RoomsWrite,
  Capability.ChatRead,
  Capability.LiveStreamsWrite,
  Capability.UsageRead,
  Capability.AuditRead,
];

const DEVELOPER_CAPS = [
  Capability.ProjectRead,
  Capability.MembersRead,
  Capability.KeysRead,
  Capability.KeysManage,
  Capability.WebhooksRead,
  Capability.WebhooksManage,
  Capability.RoomsWrite,
  Capability.ChatRead,
  Capability.LiveStreamsWrite,
  Capability.UsageRead,
];

const VIEWER_CAPS = [
  Capability.ProjectRead,
  Capability.MembersRead,
  Capability.KeysRead,
  Capability.WebhooksRead,
  Capability.ChatRead,
  Capability.UsageRead,
];

const BILLING_CAPS = [Capability.ProjectRead, Capability.UsageRead, Capability.BillingManage];

describe('can()', () => {
  it('OWNER can do everything — every capability the enum knows about', () => {
    for (const capability of Object.values(Capability)) {
      expect(can(OWNER_CAPS, capability)).toBe(true);
    }
  });

  it('ADMIN can manage members and keys, but not delete the project or manage billing', () => {
    expect(can(ADMIN_CAPS, Capability.MembersManage)).toBe(true);
    expect(can(ADMIN_CAPS, Capability.KeysManage)).toBe(true);
    expect(can(ADMIN_CAPS, Capability.ProjectDelete)).toBe(false);
    expect(can(ADMIN_CAPS, Capability.BillingManage)).toBe(false);
  });

  it('DEVELOPER can manage keys, but not members or the project itself', () => {
    expect(can(DEVELOPER_CAPS, Capability.KeysManage)).toBe(true);
    expect(can(DEVELOPER_CAPS, Capability.RoomsWrite)).toBe(true);
    expect(can(DEVELOPER_CAPS, Capability.MembersManage)).toBe(false);
    expect(can(DEVELOPER_CAPS, Capability.ProjectWrite)).toBe(false);
  });

  it('VIEWER can read but never manage anything', () => {
    expect(can(VIEWER_CAPS, Capability.ProjectRead)).toBe(true);
    expect(can(VIEWER_CAPS, Capability.KeysManage)).toBe(false);
    expect(can(VIEWER_CAPS, Capability.MembersManage)).toBe(false);
    expect(can(VIEWER_CAPS, Capability.WebhooksManage)).toBe(false);
  });

  it('BILLING sees usage and the project, manages billing, and nothing else — not even chat:read', () => {
    expect(can(BILLING_CAPS, Capability.UsageRead)).toBe(true);
    expect(can(BILLING_CAPS, Capability.BillingManage)).toBe(true);
    expect(can(BILLING_CAPS, Capability.ChatRead)).toBe(false);
    expect(can(BILLING_CAPS, Capability.MembersRead)).toBe(false);
  });

  it('treats missing or empty capability data as "can do nothing", never as "can do everything"', () => {
    expect(can(undefined, Capability.ProjectRead)).toBe(false);
    expect(can([], Capability.ProjectRead)).toBe(false);
  });

  it('is not fooled by an unrelated string that merely looks similar', () => {
    // 'members:manage-all' contains 'members:manage' as a prefix — a naive
    // startsWith check would wrongly grant this. can() must use exact
    // membership, not substring matching.
    expect(can(['members:manage-all'], Capability.MembersManage)).toBe(false);
  });
});

describe('createPermissionChecker()', () => {
  it('binds one capability set so multiple checks read as can(capability)', () => {
    const can = createPermissionChecker(ADMIN_CAPS);
    expect(can(Capability.MembersManage)).toBe(true);
    expect(can(Capability.BillingManage)).toBe(false);
  });

  it('handles an unrecognised viewer (no capabilities) as fully unprivileged', () => {
    const can = createPermissionChecker(undefined);
    expect(can(Capability.ProjectRead)).toBe(false);
  });
});
