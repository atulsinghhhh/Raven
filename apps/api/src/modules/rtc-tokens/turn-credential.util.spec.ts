import { createHmac } from 'crypto';
import { buildIceServers, generateTurnCredential } from './turn-credential.util';

describe('generateTurnCredential', () => {
  it('produces a username in "<expiry>:<label>" form, expiring ttlSeconds from now', () => {
    const before = Math.floor(Date.now() / 1000);
    const { username } = generateTurnCredential('secret', 3600, 'alice');
    const after = Math.floor(Date.now() / 1000);

    const [expiryStr, label] = username.split(':');
    const expiry = parseInt(expiryStr, 10);

    expect(label).toBe('alice');
    expect(expiry).toBeGreaterThanOrEqual(before + 3600);
    expect(expiry).toBeLessThanOrEqual(after + 3600);
  });

  it('derives the credential as base64(HMAC-SHA1(secret, username)) — the exact scheme coturn expects', () => {
    const { username, credential } = generateTurnCredential('my-secret', 600, 'bob');
    const expected = createHmac('sha1', 'my-secret').update(username).digest('base64');
    expect(credential).toBe(expected);
  });

  it('produces a different credential for a different secret (proves the secret is load-bearing)', () => {
    const a = generateTurnCredential('secret-a', 600, 'carol');
    const credentialWithSecretB = createHmac('sha1', 'secret-b').update(a.username).digest('base64');
    expect(a.credential).not.toBe(credentialWithSecretB);
  });
});

describe('buildIceServers', () => {
  it('returns one STUN entry with no credentials, and two TURN entries (UDP + TCP) sharing one credential pair', () => {
    const servers = buildIceServers({
      turnHost: 'localhost',
      turnPort: 3478,
      turnSecret: 'test-secret',
      participantIdentity: 'alice',
      ttlSeconds: 600,
    });

    expect(servers).toHaveLength(3);

    const stun = servers.find((s) => typeof s.urls === 'string' && s.urls.startsWith('stun:'));
    expect(stun).toBeDefined();
    expect(stun?.username).toBeUndefined();
    expect(stun?.credential).toBeUndefined();

    const turnUdp = servers.find((s) => typeof s.urls === 'string' && s.urls.includes('transport=udp'));
    const turnTcp = servers.find((s) => typeof s.urls === 'string' && s.urls.includes('transport=tcp'));
    expect(turnUdp?.username).toBeDefined();
    expect(turnTcp?.username).toBe(turnUdp?.username);
    expect(turnTcp?.credential).toBe(turnUdp?.credential);
  });

  it('embeds the host:port exactly as given, never an internal Docker service name', () => {
    const servers = buildIceServers({
      turnHost: 'turn.example.com',
      turnPort: 3478,
      turnSecret: 'test-secret',
      participantIdentity: 'alice',
      ttlSeconds: 600,
    });

    for (const server of servers) {
      expect(server.urls).toContain('turn.example.com:3478');
      expect(server.urls).not.toContain('coturn'); // the Docker service name
    }
  });

  it('ties the TURN username to the requesting participant identity', () => {
    const servers = buildIceServers({
      turnHost: 'localhost',
      turnPort: 3478,
      turnSecret: 'test-secret',
      participantIdentity: 'specific-participant-42',
      ttlSeconds: 600,
    });

    const turnServer = servers.find((s) => typeof s.urls === 'string' && s.urls.startsWith('turn:'));
    expect(turnServer?.username).toContain('specific-participant-42');
  });

  it('does not include a turns: entry when turnTlsPort is not provided (no TLS listener configured)', () => {
    const servers = buildIceServers({
      turnHost: 'localhost',
      turnPort: 3478,
      turnSecret: 'test-secret',
      participantIdentity: 'alice',
      ttlSeconds: 600,
    });

    expect(servers.some((s) => typeof s.urls === 'string' && s.urls.startsWith('turns:'))).toBe(false);
  });

  it('includes a turns: (TLS) entry with matching credentials when turnTlsPort is provided', () => {
    const servers = buildIceServers({
      turnHost: 'localhost',
      turnPort: 3478,
      turnTlsPort: 5349,
      turnSecret: 'test-secret',
      participantIdentity: 'alice',
      ttlSeconds: 600,
    });

    expect(servers).toHaveLength(4);

    const turns = servers.find((s) => typeof s.urls === 'string' && s.urls.startsWith('turns:'));
    const turnUdp = servers.find((s) => typeof s.urls === 'string' && s.urls.includes('transport=udp'));

    expect(turns).toBeDefined();
    expect(turns?.urls).toContain('localhost:5349');
    expect(turns?.username).toBe(turnUdp?.username);
    expect(turns?.credential).toBe(turnUdp?.credential);
  });
});
