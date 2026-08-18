import { jest } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCredentials } from '../../src/lib/auth-store.js';
import { writeCliConfig } from '../../src/lib/cli-config.js';
import { mockApi, runCli } from './helpers.js';

describe('raven connections / errors / diagnostics (integration)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'raven-cli-int-'));
    process.env.RAVEN_CONFIG_DIR = dir;
    await writeCliConfig({ apiUrl: 'http://api.test', currentProject: 'proj-1' });
    await writeCredentials({ token: 'jwt-token', email: 'dev@example.com', apiUrl: 'http://api.test', createdAt: '2026-01-01T00:00:00.000Z' });
  });

  afterEach(async () => {
    delete process.env.RAVEN_CONFIG_DIR;
    await rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('connections list renders real connection state, never fabricating a status', async () => {
    mockApi({
      'GET /v1/projects/proj-1/connections': async () => ({
        status: 200,
        body: [
          {
            id: 'row-1', publicId: 'conn_abc', projectId: 'proj-1', roomId: 'room-1', roomName: 'demo-room',
            participantId: null, participantIdentity: 'alice', state: 'CONNECTED', disconnectReason: null,
            region: null, sdkVersion: '0.1.0', platform: 'web', browser: 'chrome', networkType: null,
            iceConnectionState: null, signalingState: null, reconnectCount: 0,
            startedAt: '2026-01-01T00:00:00.000Z', connectedAt: '2026-01-01T00:00:01.000Z', disconnectedAt: null,
            durationMs: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
          },
        ],
      }),
    });

    const result = await runCli(['connections', 'list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conn_abc');
    expect(result.stdout).toContain('demo-room');
    expect(result.stdout).toContain('alice');
    expect(result.stdout).toContain('CONNECTED');
  });

  it('connections list --json emits valid, unmixed JSON', async () => {
    mockApi({ 'GET /v1/projects/proj-1/connections': async () => ({ status: 200, body: [] }) });

    const result = await runCli(['connections', 'list', '--json']);

    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  it('connections inspect shows the timeline and any errors for that connection', async () => {
    mockApi({
      'GET /v1/projects/proj-1/connections/conn_abc': async () => ({
        status: 200,
        body: {
          publicId: 'conn_abc', roomName: 'demo-room', participantIdentity: 'alice', state: 'DISCONNECTED',
          reconnectCount: 1, sdkVersion: '0.1.0', platform: 'web', browser: 'chrome', region: null,
          startedAt: '2026-01-01T00:00:00.000Z', connectedAt: '2026-01-01T00:00:01.000Z',
          disconnectedAt: '2026-01-01T00:05:00.000Z', durationMs: 299000, disconnectReason: null,
          events: [
            { id: 'e1', type: 'connection_started', data: null, timestamp: '2026-01-01T00:00:00.000Z' },
            { id: 'e2', type: 'connected', data: null, timestamp: '2026-01-01T00:00:01.000Z' },
          ],
          errors: [],
        },
      }),
    });

    const result = await runCli(['connections', 'inspect', 'conn_abc']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('conn_abc');
    expect(result.stdout).toContain('connection_started');
    expect(result.stdout).toContain('connected');
  });

  it('errors list shows the Raven-facing category, never a raw internal code', async () => {
    mockApi({
      'GET /v1/projects/proj-1/errors': async () => ({
        status: 200,
        body: [
          {
            id: 'row-1', publicId: 'err_abc', projectId: 'proj-1', connectionId: 'conn_abc', roomId: 'room-1',
            participantId: null, category: 'TOKEN_ERROR', message: 'RTC token has expired',
            likelyCause: 'The token expired.', suggestedAction: 'Mint a fresh token.',
            sdkVersion: '0.1.0', platform: 'web', timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    });

    const result = await runCli(['errors', 'list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('TOKEN_ERROR');
    expect(result.stdout).toContain('err_abc');
    expect(result.stdout).not.toContain('ERR_JWT_EXPIRED');
  });

  it('errors inspect shows the likely cause and suggested action, hedged not certain', async () => {
    mockApi({
      'GET /v1/projects/proj-1/errors/err_abc': async () => ({
        status: 200,
        body: {
          publicId: 'err_abc', category: 'ICE_ERROR', message: 'ICE connectivity failed',
          likelyCause: 'Likely a firewall/NAT restriction.', suggestedAction: 'Ensure TURN is reachable.',
          timestamp: '2026-01-01T00:00:00.000Z', connectionId: 'conn_abc', roomId: 'room-1',
          sdkVersion: '0.1.0', platform: 'web',
        },
      }),
    });

    const result = await runCli(['errors', 'inspect', 'err_abc']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ICE_ERROR');
    expect(result.stdout).toContain('firewall/NAT');
    expect(result.stdout).toContain('Ensure TURN is reachable');
  });

  it('diagnostics reports real per-dependency status and never fabricates client-side ICE/browser state', async () => {
    mockApi({
      'GET /v1/projects/proj-1/diagnostics': async () => ({
        status: 200,
        body: {
          project: { id: 'proj-1', name: 'my-video-app' },
          api: 'up',
          authentication: 'ok',
          dependencies: { signaling: 'up', sfu: 'up', turn: 'down' },
          connections: { active: 2 },
        },
      }),
    });

    const result = await runCli(['diagnostics']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('my-video-app');
    expect(result.stdout).toContain('TURN: Unhealthy');
    expect(result.stdout).toContain('SFU: Healthy');
    // Client-side diagnostics require an active browser connection — the
    // CLI must point to the SDK, never fabricate ICE/browser state itself.
    expect(result.stdout).toContain('getDiagnostics()');
  });

  it('diagnostics --json emits real data only, no fabricated fields', async () => {
    mockApi({
      'GET /v1/projects/proj-1/diagnostics': async () => ({
        status: 200,
        body: {
          project: { id: 'proj-1', name: 'my-video-app' },
          api: 'up',
          authentication: 'ok',
          dependencies: { signaling: 'up', sfu: 'up', turn: 'up' },
          connections: { active: 0 },
        },
      }),
    });

    const result = await runCli(['diagnostics', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.connections.active).toBe(0);
    expect(parsed.project.name).toBe('my-video-app');
  });
});
