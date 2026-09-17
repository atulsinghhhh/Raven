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
    expect(() => validateEnv(baseConfig({ API_PORT: 99999 }))).toThrow(/Invalid environment configuration/);
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
      /TURN_TLS_PORT.*CORS_ORIGIN.*TURN_HOST.*RTC_TOKEN_SECRET.*SFU_REGISTRATION_SECRET.*METRICS_SCRAPE_SECRET.*CHAT_TOKEN_SECRET.*DASHBOARD_WS_TOKEN_SECRET/s,
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
      DASHBOARD_WS_TOKEN_SECRET: 'a-distinct-dashboard-ws-token-secret',
      SFU_REGISTRATION_SECRET: 'a-distinct-sfu-registration-secret',
      METRICS_SCRAPE_SECRET: 'a-metrics-scrape-secret',
      STORAGE_ENDPOINT: 'https://storage.example.com',
      API_PUBLIC_URL: 'https://api.example.com',
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
    expect(() => validateEnv(productionConfig({ RTC_TOKEN_SECRET: 'a-jwt-secret-at-least-this-long' }))).toThrow(
      /RTC_TOKEN_SECRET must differ from JWT_SECRET/,
    );
  });

  it('rejects an RTC-token secret shared with chat', () => {
    // Media and messaging are separate capabilities; one leaked key must
    // not grant both.
    expect(() => validateEnv(productionConfig({ RTC_TOKEN_SECRET: 'a-distinct-chat-token-secret' }))).toThrow(
      /RTC_TOKEN_SECRET must differ from CHAT_TOKEN_SECRET/,
    );
  });

  it('rejects production config without an SFU registration secret', () => {
    // Without it, any host that can reach the API can join the RTC fleet
    // and be handed rooms to serve (spec §23, §38).
    expect(() => validateEnv(productionConfig({ SFU_REGISTRATION_SECRET: undefined }))).toThrow(
      /SFU_REGISTRATION_SECRET is required in production/,
    );
  });

  it('rejects an SFU registration secret shared with the client token secret', () => {
    // A client token secret is held by whatever mints tokens; the fleet
    // credential must not be derivable from it.
    expect(() => validateEnv(productionConfig({ SFU_REGISTRATION_SECRET: 'a-distinct-rtc-token-secret' }))).toThrow(
      /SFU_REGISTRATION_SECRET must differ from RTC_TOKEN_SECRET/,
    );
  });

  it('rejects production config without a dedicated dashboard-ws-token secret', () => {
    // Same reasoning as CHAT_TOKEN_SECRET/RTC_TOKEN_SECRET: a leaked
    // dashboard-session key must not be able to mint dashboard realtime
    // credentials (Phase 5B).
    expect(() => validateEnv(productionConfig({ DASHBOARD_WS_TOKEN_SECRET: undefined }))).toThrow(
      /DASHBOARD_WS_TOKEN_SECRET is required in production/,
    );
  });

  it('rejects a dashboard-ws-token secret that is just the JWT secret again', () => {
    expect(() =>
      validateEnv(productionConfig({ DASHBOARD_WS_TOKEN_SECRET: 'a-jwt-secret-at-least-this-long' })),
    ).toThrow(/DASHBOARD_WS_TOKEN_SECRET must differ from JWT_SECRET/);
  });

  it('rejects a dashboard-ws-token secret shared with chat', () => {
    expect(() => validateEnv(productionConfig({ DASHBOARD_WS_TOKEN_SECRET: 'a-distinct-chat-token-secret' }))).toThrow(
      /DASHBOARD_WS_TOKEN_SECRET must differ from CHAT_TOKEN_SECRET/,
    );
  });

  it('rejects a dashboard-ws-token secret shared with RTC', () => {
    expect(() => validateEnv(productionConfig({ DASHBOARD_WS_TOKEN_SECRET: 'a-distinct-rtc-token-secret' }))).toThrow(
      /DASHBOARD_WS_TOKEN_SECRET must differ from RTC_TOKEN_SECRET/,
    );
  });

  it('rejects production config without a metrics scrape secret', () => {
    // Without it, GET /metrics is public and unauthenticated — it leaks
    // business volume, the internal route map, and a live success/failure
    // oracle to anyone who requests it.
    expect(() => validateEnv(productionConfig({ METRICS_SCRAPE_SECRET: undefined }))).toThrow(
      /METRICS_SCRAPE_SECRET is required in production/,
    );
  });

  it('rejects an unencrypted signaling URL in production', () => {
    // RTC tokens travel on this connection as a query parameter.
    expect(() => validateEnv(productionConfig({ RTC_SIGNALING_URL: 'ws://rtc.example.com/v1/rtc' }))).toThrow(
      /RTC_SIGNALING_URL must use wss/,
    );
  });

  it('accepts a fully-correct production configuration', () => {
    expect(() => validateEnv(productionConfig())).not.toThrow();
  });

  // API_PUBLIC_URL becomes the RTC `endpoint`, chat's `chatUrl`/`apiUrl`
  // and `telemetryUrl` in every mint response. A wrong value here never
  // fails for the API — it fails in each customer's client, and they have
  // no way to override it. See docs/RELEASE_READINESS_AUDIT.md; this
  // regressed twice because nothing checked it at deploy time.
  describe('API_PUBLIC_URL', () => {
    it('requires it in production', () => {
      expect(() => validateEnv(productionConfig({ API_PUBLIC_URL: undefined }))).toThrow(
        /API_PUBLIC_URL is required in production/,
      );
    });

    it('rejects http:// — Android blocks cleartext, so every mobile client fails', () => {
      expect(() => validateEnv(productionConfig({ API_PUBLIC_URL: 'http://api.example.com' }))).toThrow(
        /API_PUBLIC_URL must use https/,
      );
    });

    it("rejects localhost — clients cannot reach the API's own loopback", () => {
      expect(() => validateEnv(productionConfig({ API_PUBLIC_URL: 'https://localhost:4100' }))).toThrow(
        /must be a public hostname in production/,
      );
    });

    it('rejects a cluster-internal hostname', () => {
      expect(() => validateEnv(productionConfig({ API_PUBLIC_URL: 'https://raven-api.internal' }))).toThrow(
        /not the cluster-internal/,
      );
    });

    it('rejects the provider-generated hostname that actually shipped', () => {
      // The exact value production served: valid TLS, publicly resolvable,
      // and still wrong — it is tied to the Container App, so recreating
      // it invalidates every endpoint already handed to a client.
      expect(() =>
        validateEnv(
          productionConfig({
            API_PUBLIC_URL: 'https://raven-api.salmontree-6311a7e1.eastasia.azurecontainerapps.io',
            RTC_SIGNALING_URL: 'wss://raven-api.salmontree-6311a7e1.eastasia.azurecontainerapps.io/v1/rtc',
          }),
        ),
      ).toThrow(/provider-generated hostname/);
    });

    it('does not mistake a customer domain for a generated one', () => {
      expect(() =>
        validateEnv(productionConfig({ API_PUBLIC_URL: 'https://api.notazurecontainerapps.io.example.com' })),
      ).not.toThrow();
    });

    it('rejects a signaling URL pointing at a different host', () => {
      expect(() =>
        validateEnv(
          productionConfig({
            API_PUBLIC_URL: 'https://api.example.com',
            RTC_SIGNALING_URL: 'wss://rtc.elsewhere.example.com/v1/rtc',
          }),
        ),
      ).toThrow(/does not match API_PUBLIC_URL host/);
    });

    it('accepts a signaling URL on the same host', () => {
      expect(() =>
        validateEnv(
          productionConfig({
            API_PUBLIC_URL: 'https://api.example.com',
            RTC_SIGNALING_URL: 'wss://api.example.com/v1/rtc',
          }),
        ),
      ).not.toThrow();
    });

    it('rejects a value that is not a URL at all', () => {
      expect(() => validateEnv(productionConfig({ API_PUBLIC_URL: 'api.example.com' }))).toThrow(
        /must be an absolute URL/,
      );
    });

    it('stays out of the way outside production', () => {
      expect(() => validateEnv(baseConfig({ API_PUBLIC_URL: 'http://localhost:4100' }))).not.toThrow();
    });
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
      validateEnv(emailConfig({ EMAIL_ENABLED: 'true', RESEND_FROM_EMAIL: 'hello@mail.ravenstack.online' })),
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
          RESEND_FROM_NAME: 'Livqeno',
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
        DASHBOARD_WS_TOKEN_SECRET: 'a-distinct-dashboard-ws-token-secret',
        SFU_REGISTRATION_SECRET: 'a-distinct-sfu-registration-secret',
        METRICS_SCRAPE_SECRET: 'a-metrics-scrape-secret',
        EMAIL_ENABLED: 'true',
        RESEND_API_KEY: 'a-real-looking-key',
        RESEND_FROM_EMAIL: 'hello@mail.ravenstack.online',
        APP_URL: 'https://app.ravenstack.online',
        API_PUBLIC_URL: 'https://api.ravenstack.online',
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
