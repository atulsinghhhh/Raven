// Typed BFF client for the five "ops" sections: Errors (§15), Security
// (§16), Infrastructure (§17), Admins (§3/§9), Settings (§21). Same
// `superAdminFetch` pattern every other super-admin domain client uses —
// the API re-checks the platform role on every request regardless of
// what this file assumes.
import { buildQuery, superAdminFetch } from '../super-admin-client';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'TOKEN_ERROR'
  | 'SIGNALING_ERROR'
  | 'ICE_ERROR'
  | 'TURN_ERROR'
  | 'SFU_ERROR'
  | 'NETWORK_ERROR'
  | 'CLIENT_ERROR'
  | 'UNKNOWN_ERROR';

export interface GroupedErrorRow {
  category: ErrorCategory;
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  affectedProjects: number;
  affectedDevelopers: number;
}

export interface GroupedErrorPage {
  items: GroupedErrorRow[];
  total: number;
}

export interface ErrorFilters {
  category?: ErrorCategory;
  limit?: number;
  offset?: number;
}

export interface ErrorDetail {
  id: string;
  publicId: string;
  projectId: string;
  environment: string;
  connectionId: string | null;
  roomId: string | null;
  participantId: string | null;
  category: ErrorCategory;
  message: string;
  likelyCause: string | null;
  suggestedAction: string | null;
  sdkVersion: string | null;
  platform: string | null;
  timestamp: string;
  connection: Record<string, unknown> | null;
  project: { id: string; name: string; ownerId: string; owner: { id: string; email: string } } | null;
}

export function getErrors(token: string, filters: ErrorFilters = {}): Promise<GroupedErrorPage> {
  return superAdminFetch<GroupedErrorPage>(
    `/v1/super-admin/errors${buildQuery(filters as Record<string, string | number | boolean | undefined>)}`,
    { token },
  );
}

export function getError(token: string, id: string): Promise<ErrorDetail> {
  return superAdminFetch<ErrorDetail>(`/v1/super-admin/errors/${id}`, { token });
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskIndicator {
  developerId: string;
  email: string | null;
  riskLevel: RiskLevel;
  reasons: string[];
  loginFailedCount24h: number;
  suspiciousOrRateLimitCount7d: number;
  suspendedInLast24h: boolean;
}

export interface SecurityOverview {
  generatedAt: string;
  failedLogins: { today: number; thisWeek: number };
  suspiciousActivity: { today: number; thisWeek: number };
  rateLimitViolations: { today: number; thisWeek: number };
  accountLockouts: { today: number; thisWeek: number; currentlySuspended: number };
  revokedApiKeys: { today: number; thisWeek: number };
  adminSecurityEvents: { today: number; thisWeek: number };
  riskIndicators: RiskIndicator[];
}

export function getSecurity(token: string): Promise<SecurityOverview> {
  return superAdminFetch<SecurityOverview>('/v1/super-admin/security', { token });
}

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export type DependencyStatus = 'up' | 'down';

export interface RtcServerNode {
  id: string;
  name: string;
  region: string;
  status: 'HEALTHY' | 'DRAINING' | 'UNHEALTHY';
  publicHost: string;
  internalUrl: string;
  capacity: number;
  activeRooms: number;
  activeParticipants: number;
  cpuPercent: number | null;
  memoryPercent: number | null;
  networkInBps: number | null;
  networkOutBps: number | null;
  version: string | null;
  lastHeartbeatAt: string | null;
  registeredAt: string;
  updatedAt: string;
}

export interface InfrastructureOverview {
  generatedAt: string;
  dependencies: {
    api: 'up';
    database: DependencyStatus;
    redis: DependencyStatus;
    sfu: DependencyStatus;
    turn: DependencyStatus;
  };
  fleet: {
    servers: number;
    healthyServers: number;
    drainingServers: number;
    unhealthyServers: number;
    activeRooms: number;
    activeParticipants: number;
    capacity: number;
  };
  nodes: RtcServerNode[];
}

export function getInfrastructure(token: string): Promise<InfrastructureOverview> {
  return superAdminFetch<InfrastructureOverview>('/v1/super-admin/infrastructure', { token });
}

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

export type PlatformRoleName = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'READ_ONLY';

export interface PlatformAdminRow {
  id: string;
  email: string;
  name: string | null;
  platformRole: PlatformRoleName;
  createdAt: string;
}

export function listAdmins(token: string): Promise<PlatformAdminRow[]> {
  return superAdminFetch<PlatformAdminRow[]>('/v1/super-admin/admins', { token });
}

export function grantAdmin(
  token: string,
  input: { email: string; platformRole: PlatformRoleName; reason: string },
): Promise<PlatformAdminRow> {
  return superAdminFetch<PlatformAdminRow>('/v1/super-admin/admins', { token, method: 'POST', body: input });
}

export function revokeAdmin(token: string, userId: string, reason: string): Promise<void> {
  return superAdminFetch<void>(`/v1/super-admin/admins/${userId}`, { token, method: 'DELETE', body: { reason } });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  adminAuditLogs: string;
  securityEvents: string;
  businessActivityEvents: string;
  highVolumeTelemetry: string;
}

export interface PlatformRoleDescription {
  role: PlatformRoleName;
  summary: string;
  canDo: string[];
}

export interface SettingsResponse {
  retentionPolicy: RetentionPolicy;
  platformRoles: PlatformRoleDescription[];
}

export function getSettings(token: string): Promise<SettingsResponse> {
  return superAdminFetch<SettingsResponse>('/v1/super-admin/settings', { token });
}
