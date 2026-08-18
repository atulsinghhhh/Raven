import { Capability, ProjectRole, can, canAssignRole, capabilitiesFor } from './project-permissions';

const ROLES = Object.values(ProjectRole);

describe('project permissions', () => {
  describe('the matrix', () => {
    it('gives an owner everything', () => {
      for (const capability of Object.values(Capability)) {
        expect(can(ProjectRole.OWNER, capability)).toBe(true);
      }
    });

    it('lets every role see the project it belongs to', () => {
      // A member who cannot read the project cannot use the dashboard at
      // all, which makes their membership meaningless.
      for (const role of ROLES) {
        expect(can(role, Capability.ProjectRead)).toBe(true);
      }
    });

    it('reserves deleting a project for its owner', () => {
      // It takes every key, room and conversation with it.
      for (const role of ROLES) {
        expect(can(role, Capability.ProjectDelete)).toBe(role === ProjectRole.OWNER);
      }
    });

    it('lets developers manage their own keys', () => {
      // Making them ask an admin for every key pushes people towards
      // sharing one, which is the worse outcome.
      expect(can(ProjectRole.DEVELOPER, Capability.KeysManage)).toBe(true);
    });

    it('stops developers from changing who has access', () => {
      expect(can(ProjectRole.DEVELOPER, Capability.MembersManage)).toBe(false);
      expect(can(ProjectRole.DEVELOPER, Capability.ProjectWrite)).toBe(false);
    });

    it('keeps a viewer read-only', () => {
      const writes = [
        Capability.ProjectWrite,
        Capability.ProjectDelete,
        Capability.MembersManage,
        Capability.KeysManage,
        Capability.WebhooksManage,
        Capability.RoomsWrite,
        Capability.BillingManage,
      ];
      for (const capability of writes) {
        expect(can(ProjectRole.VIEWER, capability)).toBe(false);
      }
    });

    it('keeps billing away from customer data', () => {
      // Someone who needs an invoice does not need a list of the
      // customers' conversations (spec §24).
      expect(can(ProjectRole.BILLING, Capability.ChatRead)).toBe(false);
      expect(can(ProjectRole.BILLING, Capability.KeysRead)).toBe(false);
      expect(can(ProjectRole.BILLING, Capability.UsageRead)).toBe(true);
      expect(can(ProjectRole.BILLING, Capability.BillingManage)).toBe(true);
    });

    it('never grants a manage capability without its read counterpart', () => {
      // A role that can change something it cannot see would be a UI that
      // cannot work and an audit trail nobody can interpret.
      const pairs: Array<[Capability, Capability]> = [
        [Capability.KeysManage, Capability.KeysRead],
        [Capability.WebhooksManage, Capability.WebhooksRead],
        [Capability.MembersManage, Capability.MembersRead],
      ];
      for (const role of ROLES) {
        for (const [manage, read] of pairs) {
          if (can(role, manage)) {
            expect(can(role, read)).toBe(true);
          }
        }
      }
    });

    it('reports exactly what a role can do, for the dashboard to hide the rest', () => {
      const viewer = capabilitiesFor(ProjectRole.VIEWER);
      expect(viewer).toContain(Capability.ProjectRead);
      expect(viewer).not.toContain(Capability.KeysManage);
    });
  });

  describe('canAssignRole', () => {
    it('lets an owner grant the owner role', () => {
      expect(canAssignRole(ProjectRole.OWNER, ProjectRole.OWNER)).toBe(true);
    });

    it('stops an admin granting the owner role', () => {
      // Otherwise an admin promotes themselves and the OWNER role is
      // decorative — they could then demote the real owner.
      expect(canAssignRole(ProjectRole.ADMIN, ProjectRole.OWNER)).toBe(false);
    });

    it('lets an admin grant every role below owner', () => {
      for (const role of [ProjectRole.ADMIN, ProjectRole.DEVELOPER, ProjectRole.VIEWER, ProjectRole.BILLING]) {
        expect(canAssignRole(ProjectRole.ADMIN, role)).toBe(true);
      }
    });

    it('stops anyone without members:manage assigning anything at all', () => {
      for (const role of [ProjectRole.DEVELOPER, ProjectRole.VIEWER, ProjectRole.BILLING]) {
        expect(canAssignRole(role, ProjectRole.VIEWER)).toBe(false);
      }
    });
  });
});
