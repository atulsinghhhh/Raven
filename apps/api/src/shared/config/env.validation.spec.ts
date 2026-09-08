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
    // No TURN_TLS_PORT, CORS_ORIGIN defaults to "*", TURN_HOST=localhost;
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
        }),
      ),
    ).toThrow(/TURN_HOST must be a real public hostname/);
  });


  it('reports every violated production rule at once, not just the first', () => {
    expect(() => validateEnv(baseConfig({ NODE_ENV: 'production' }))).toThrow(
      /TURN_TLS_PORT.*CORS_ORIGIN.*TURN_HOST.*RTC_TOKEN_SECRET.*SFU_REGISTRATION_SECRET.*CHAT_TOKEN_SECRET/s,
    );
  });

  /**
   * A production config with every guard satisfied. Individual tests
   * override one key to prove that guard fires, which keeps the "fully
   * correct" case and the rejection cases from drifting apart as new
   * required settings are added.
   */
  function productionConfig(overrides: Record<string, unknown> = {}) {
    return baseConfig({
      NODE_ENV: 'production',
      TURN_TLS_PORT: 5349,
      CORS_ORIGIN: 'https://app.example.com',
      TURN_HOST: 'turn.example.com',
      CHAT_TOKEN_SECRET: 'a-distinct-chat-token-secret',
      RTC_TOKEN_SECRET: 'a-distinct-rtc-token-secret',
      SFU_REGISTRATION_SECRET: 'a-distinct-sfu-registration-secret',
      STORAGE_ENDPOINT: 'https://storage.example.com',
      ...overrides,
    });
  }

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
          CHAT_TOKEN_SECRET: 'a-distinct-chat-secret',
          STORAGE_ENDPOINT: 'http://storage.example.com',
        }),
      ),
    ).toThrow(/STORAGE_ENDPOINT must use https/);
  });

  it('rejects production config without a dedicated RTC-token secret', () => {
    // Same reasoning as CHAT_TOKEN_SECRET: a leaked dashboard-session key
    // must not be able to mint media credentials.
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          TURN_TLS_PORT: 5349,
          CORS_ORIGIN: 'https://app.example.com',
          TURN_HOST: 'turn.example.com',
          CHAT_TOKEN_SECRET: 'a-distinct-chat-token-secret',
        }),
      ),
    ).toThrow(/RTC_TOKEN_SECRET is required in production/);
  });

  it('rejects an RTC-token secret that is just the JWT secret again', () => {
    expect(() =>
      validateEnv(
        productionConfig({ RTC_TOKEN_SECRET: 'a-jwt-secret-at-least-this-long' }),
      ),
    ).toThrow(/RTC_TOKEN_SECRET must differ from JWT_SECRET/);
  });

  it('rejects an RTC-token secret shared with chat', () => {
    // Media and messaging are separate capabilities; one leaked key must
    // not grant both.
    expect(() =>
      validateEnv(
        productionConfig({ RTC_TOKEN_SECRET: 'a-distinct-chat-token-secret' }),
      ),
    ).toThrow(/RTC_TOKEN_SECRET must differ from CHAT_TOKEN_SECRET/);
  });

  it('rejects production config without an SFU registration secret', () => {
    // Without it, any host that can reach the API can join the RTC fleet
    // and be handed rooms to serve (spec §23, §38).
    expect(() =>
      validateEnv(
        productionConfig({ SFU_REGISTRATION_SECRET: undefined }),
      ),
    ).toThrow(/SFU_REGISTRATION_SECRET is required in production/);
  });

  it('rejects an SFU registration secret shared with the client token secret', () => {
    // A client token secret is held by whatever mints tokens; the fleet
    // credential must not be derivable from it.
    expect(() =>
      validateEnv(
        productionConfig({ SFU_REGISTRATION_SECRET: 'a-distinct-rtc-token-secret' }),
      ),
    ).toThrow(/SFU_REGISTRATION_SECRET must differ from RTC_TOKEN_SECRET/);
  });

  it('rejects an unencrypted signaling URL in production', () => {
    // RTC tokens travel on this connection as a query parameter.
    expect(() =>
      validateEnv(productionConfig({ RTC_SIGNALING_URL: 'ws://rtc.example.com/v1/rtc' })),
    ).toThrow(/RTC_SIGNALING_URL must use wss/);
  });

  it('accepts a fully-correct production configuration', () => {
    expect(() => validateEnv(productionConfig())).not.toThrow();
  });
});

describe('validateEnv — email (Resend)', () => {
  function emailConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      API_PORT: 4100,
      JWT_SECRET: 'a-jwt-secret-at-least-this-long',
      JWT_EXPIRES_IN: '12h',
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

  it('boots with email off and nothing else configured — the default local setup', () => {
    expect(() => validateEnv(emailConfig({ EMAIL_ENABLED: 'false' }))).not.toThrow();
  });

  it('boots when EMAIL_ENABLED is absent entirely', () => {
    expect(() => validateEnv(emailConfig())).not.toThrow();
  });

  it('refuses to start when email is enabled without an API key', () => {
    // The failure mode this prevents: the app boots, accepts signups, and
    // silently cannot send the verification address they depend on.
    expect(() =>
      validateEnv(
        emailConfig({ EMAIL_ENABLED: 'true', RESEND_FROM_EMAIL: 'hello@mail.ravenstack.online' }),
      ),
    ).toThrow(/RESEND_API_KEY is required when EMAIL_ENABLED=true/);
  });

  it('rejects the .env.example placeholder left in place', () => {
    expect(() =>
      validateEnv(
        emailConfig({
          EMAIL_ENABLED: 'true',
          RESEND_API_KEY: 're_your_api_key_here',
          RESEND_FROM_EMAIL: 'hello@mail.ravenstack.online',
        }),
      ),
    ).toThrow(/placeholder/);
  });

  it('rejects a from-address that is not an address', () => {
    expect(() =>
      validateEnv(
        emailConfig({
          EMAIL_ENABLED: 'true',
          RESEND_API_KEY: 'a-real-looking-key',
          RESEND_FROM_EMAIL: 'mail.ravenstack.online',
        }),
      ),
    ).toThrow(/RESEND_FROM_EMAIL must be a full address/);
  });

  it('accepts a complete email configuration', () => {
    expect(() =>
      validateEnv(
        emailConfig({
          EMAIL_ENABLED: 'true',
          RESEND_API_KEY: 'a-real-looking-key',
          RESEND_FROM_EMAIL: 'hello@mail.ravenstack.online',
          RESEND_FROM_NAME: 'Raven',
          APP_URL: 'http://localhost:3000',
        }),
      ),
    ).not.toThrow();
  });

  it('never repeats the API key in the failure message', () => {
    // A boot failure is often the first thing pasted into a chat or an
    // issue. It must not carry the credential with it.
    let message = '';
    try {
      validateEnv(
        emailConfig({
          EMAIL_ENABLED: 'true',
          RESEND_API_KEY: 're_a_real_looking_secret_value',
          RESEND_FROM_EMAIL: 'not-an-address',
        }),
      );
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/RESEND_FROM_EMAIL/);
    expect(message).not.toContain('re_a_real_looking_secret_value');
  });

  describe('production', () => {
    function productionEmailConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return emailConfig({
        NODE_ENV: 'production',
        TURN_TLS_PORT: 5349,
        CORS_ORIGIN: 'https://app.ravenstack.online',
        TURN_HOST: 'turn.ravenstack.online',
        CHAT_TOKEN_SECRET: 'a-distinct-chat-token-secret',
        RTC_TOKEN_SECRET: 'a-distinct-rtc-token-secret',
        SFU_REGISTRATION_SECRET: 'a-distinct-sfu-registration-secret',
        EMAIL_ENABLED: 'true',
        RESEND_API_KEY: 'a-real-looking-key',
        RESEND_FROM_EMAIL: 'hello@mail.ravenstack.online',
        APP_URL: 'https://app.ravenstack.online',
        ...overrides,
      });
    }

    it('accepts a complete production email configuration', () => {
      expect(() => validateEnv(productionEmailConfig())).not.toThrow();
    });

    it('requires APP_URL, since every emailed link is built from it', () => {
      const config = productionEmailConfig();
      delete config.APP_URL;
      expect(() => validateEnv(config)).toThrow(/APP_URL is required in production/);
    });

    it('rejects an http:// APP_URL — reset links travel over it', () => {
      expect(() => validateEnv(productionEmailConfig({ APP_URL: 'http://app.ravenstack.online' }))).toThrow(
        /APP_URL must use https/,
      );
    });

    it('rejects a localhost APP_URL in production', () => {
      expect(() => validateEnv(productionEmailConfig({ APP_URL: 'https://localhost:3000' }))).toThrow(
        /must be the real dashboard origin/,
      );
    });

    it('refuses to print live links to the logs in production', () => {
      expect(() => validateEnv(productionEmailConfig({ EMAIL_DEV_PREVIEW: 'true' }))).toThrow(
        /EMAIL_DEV_PREVIEW must not be enabled in production/,
      );
    });
  });
});
