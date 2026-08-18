// enableImplicitConversion needs Reflect.getMetadata, which only exists
// once this polyfill's loaded. main.ts imports it for the real app, but
// this spec calls validateEnv() standalone so it needs its own copy.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    API_PORT: 4100,
    JWT_SECRET: 'a-jwt-secret-at-least-this-long',
    JWT_EXPIRES_IN: '12h',
    LIVEKIT_URL: 'ws://localhost:7880',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'a-livekit-secret-at-least-this-long',
    RTC_TOKEN_DEFAULT_TTL_SECONDS: 600,
    API_KEY_HASH_SECRET: 'an-api-key-pepper-at-least-this-long',
    SIGNALING_MAX_PARTICIPANTS_PER_ROOM: 50,
    SIGNALING_MAX_MESSAGE_BYTES: 16384,
    SIGNALING_MAX_MESSAGES_PER_WINDOW: 100,
    SIGNALING_MESSAGE_WINDOW_SECONDS: 10,
    SIGNALING_MAX_CONNECTIONS_PER_WINDOW: 20,
    TURN_HOST: 'localhost',
    TURN_PORT: 3478,
    TURN_SECRET: 'a-turn-shared-secret-at-least-this-long',
    ...overrides,
  };
}

describe('validateEnv — always-required fields', () => {
  it('accepts a complete, well-formed local-dev configuration', () => {
    expect(() => validateEnv(baseConfig())).not.toThrow();
  });

  it('rejects a missing required field', () => {
    const config = baseConfig();
    delete config.TURN_SECRET;
    expect(() => validateEnv(config)).toThrow(/Invalid environment configuration/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv(baseConfig({ API_PORT: 99999 }))).toThrow(
      /Invalid environment configuration/,
    );
  });
});

describe('validateEnv — production-only checks', () => {
  it('does not enforce production checks when NODE_ENV is unset (local dev)', () => {
    // No TURN_TLS_PORT, CORS_ORIGIN defaults to "*", TURN_HOST=localhost —
    // all of that's invalid in prod but fine here.
    expect(() => validateEnv(baseConfig())).not.toThrow();
  });

  it('does not enforce production checks when NODE_ENV=development', () => {
    expect(() => validateEnv(baseConfig({ NODE_ENV: 'development' }))).not.toThrow();
  });

  it('rejects production config missing TURN_TLS_PORT', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'turn.example.com',
          LIVEKIT_URL: 'wss://rtc.example.com',
        }),
      ),
    ).toThrow(/TURN_TLS_PORT is required in production/);
  });

  it('rejects production config with a wildcard CORS_ORIGIN', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: '*',
          TURN_HOST: 'turn.example.com',
          LIVEKIT_URL: 'wss://rtc.example.com',
        }),
      ),
    ).toThrow(/CORS_ORIGIN must not be "\*" in production/);
  });

  it('rejects production config with TURN_HOST still set to localhost', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'localhost',
          LIVEKIT_URL: 'wss://rtc.example.com',
        }),
      ),
    ).toThrow(/TURN_HOST must be a real public hostname/);
  });

  it('rejects production config with an unencrypted ws:// LIVEKIT_URL', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'turn.example.com',
          LIVEKIT_URL: 'ws://rtc.example.com',
        }),
      ),
    ).toThrow(/LIVEKIT_URL must use wss/);
  });

  it('reports every violated production rule at once, not just the first', () => {
    expect(() => validateEnv(baseConfig({ NODE_ENV: 'production' }))).toThrow(
      /TURN_TLS_PORT.*CORS_ORIGIN.*TURN_HOST.*LIVEKIT_URL.*CHAT_TOKEN_SECRET/s,
    );
  });

  it('rejects production config without a dedicated chat-token secret', () => {
    // A leaked dashboard-session key must not be able to mint chat
    // credentials, so the two keys have to be distinct in production
    // (Phase 12 spec §10/§39).
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'turn.example.com',
          LIVEKIT_URL: 'wss://rtc.example.com',
        }),
      ),
    ).toThrow(/CHAT_TOKEN_SECRET is required in production/);
  });

  it('rejects a chat-token secret that is just the JWT secret again', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'turn.example.com',
          LIVEKIT_URL: 'wss://rtc.example.com',
          CHAT_TOKEN_SECRET: 'a-jwt-secret-at-least-this-long',
        }),
      ),
    ).toThrow(/CHAT_TOKEN_SECRET must differ from JWT_SECRET/);
  });

  it('rejects an unencrypted object-storage endpoint in production', () => {
    // Signed upload URLs would otherwise travel in cleartext.
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'turn.example.com',
          LIVEKIT_URL: 'wss://rtc.example.com',
          CHAT_TOKEN_SECRET: 'a-distinct-chat-secret',
          STORAGE_ENDPOINT: 'http://storage.example.com',
        }),
      ),
    ).toThrow(/STORAGE_ENDPOINT must use https/);
  });

  it('accepts a fully-correct production configuration', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'turn.example.com',
          LIVEKIT_URL: 'wss://rtc.example.com',
          CHAT_TOKEN_SECRET: 'a-distinct-chat-token-secret',
          STORAGE_ENDPOINT: 'https://storage.example.com',
        }),
      ),
    ).not.toThrow();
  });
});
