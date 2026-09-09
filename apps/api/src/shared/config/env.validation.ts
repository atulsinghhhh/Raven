import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  // Only the Prisma CLI reads this (prisma.config.ts), and only a
  // transaction-mode pooler needs it at all. Optional, so a direct Postgres
  // connection stays a one-variable setup.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  DIRECT_URL?: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT!: number;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_EXPIRES_IN!: string;

  @IsInt()
  @Min(1)
  RTC_TOKEN_DEFAULT_TTL_SECONDS!: number;

  // Native RTC. Optional so an existing .env still boots; configuration.ts
  // falls back to JWT_SECRET for local dev. The thing that genuinely matters
  // in production, a distinct RTC token secret, is enforced down in
  // validateProductionConfig() instead, exactly as CHAT_TOKEN_SECRET is.
  @IsOptional()
  @IsString()
  RTC_TOKEN_SECRET?: string;

  @IsOptional()
  @IsString()
  RTC_SIGNALING_URL?: string;

  @IsOptional()
  @IsString()
  SFU_REGISTRATION_SECRET?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  SFU_HEARTBEAT_TIMEOUT_SECONDS?: number;

  @IsOptional()
  @IsString()
  SFU_DEFAULT_REGION?: string;

  @IsString()
  @IsNotEmpty()
  API_KEY_HASH_SECRET!: string;

  @IsInt()
  @Min(1)
  SIGNALING_MAX_PARTICIPANTS_PER_ROOM!: number;

  @IsInt()
  @Min(1024)
  SIGNALING_MAX_MESSAGE_BYTES!: number;

  @IsInt()
  @Min(1)
  SIGNALING_MAX_MESSAGES_PER_WINDOW!: number;

  @IsInt()
  @Min(1)
  SIGNALING_MESSAGE_WINDOW_SECONDS!: number;

  @IsInt()
  @Min(1)
  SIGNALING_MAX_CONNECTIONS_PER_WINDOW!: number;

  // Usage metering. All optional: configuration.ts carries the defaults, so
  // an existing .env keeps booting after a `git pull`.
  @IsOptional()
  @IsInt()
  @Min(0)
  USAGE_FREE_TIER_MINUTES?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  USAGE_ENFORCE_LIMIT?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  USAGE_METER_INTERVAL_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  USAGE_REAPER_INTERVAL_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  USAGE_ABANDONED_AFTER_MS?: number;

  @IsString()
  @IsNotEmpty()
  TURN_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  TURN_PORT!: number;

  @IsString()
  @IsNotEmpty()
  TURN_SECRET!: string;

  // Optional. Unset just means we don't advertise turns: to clients,
  // because there's no TLS listener on coturn. Fine for local dev, not for
  // production, and validateProductionConfig() below catches that.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  TURN_TLS_PORT?: number;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  // Chat (Phase 12). All optional so a Phase 0-11 .env still boots;
  // configuration.ts supplies the defaults. The one that genuinely matters
  // in production, a distinct chat-token secret, is enforced down in
  // validateProductionConfig() instead.
  @IsOptional()
  @IsString()
  CHAT_TOKEN_SECRET?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  CHAT_TOKEN_DEFAULT_TTL_SECONDS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CHAT_MAX_TEXT_LENGTH?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CHAT_SEND_RATE_LIMIT?: number;

  @IsOptional()
  @IsString()
  STORAGE_BUCKET?: string;

  @IsOptional()
  @IsString()
  STORAGE_ENDPOINT?: string;

  // Transactional email (Resend). Every one of these is optional, so an
  // .env written before email existed still boots. EMAIL_ENABLED defaults to
  // false and configuration.ts supplies the rest.
  //
  // The checks that actually matter live in validateEmailConfig() below,
  // which runs in *every* environment, not production only.
  // "Enabled but no key" is a misconfiguration in dev too, and catching it
  // at boot beats catching it when the first user can't verify their
  // address.
  @IsOptional()
  @IsIn(['true', 'false'])
  EMAIL_ENABLED?: string;

  @IsOptional()
  @IsString()
  RESEND_API_KEY?: string;

  @IsOptional()
  @IsString()
  RESEND_FROM_EMAIL?: string;

  @IsOptional()
  @IsString()
  RESEND_FROM_NAME?: string;

  @IsOptional()
  @IsString()
  EMAIL_REPLY_TO?: string;

  @IsOptional()
  @IsString()
  EMAIL_SUPPORT_EMAIL?: string;

  // Base URL of the dashboard, not this API. Every link we email points at
  // it. See configuration.ts's `appUrl`.
  @IsOptional()
  @IsString()
  APP_URL?: string;

  // OAuth sign-in (GitHub / Google). All optional: a provider is enabled by
  // setting its client id, and validateOAuthConfig() below is what refuses
  // a half-configured provider at boot. Secrets are checked, never echoed.
  @IsOptional()
  @IsString()
  GITHUB_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GITHUB_CLIENT_SECRET?: string;

  // Where the provider sends the browser back. Defaults to a route on
  // APP_URL (the dashboard) — see configuration.ts. Must match the callback
  // URL registered in the provider's OAuth app settings exactly.
  @IsOptional()
  @IsString()
  GITHUB_CALLBACK_URL?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CALLBACK_URL?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  OAUTH_STATE_TTL_SECONDS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMAIL_VERIFICATION_TTL_MINUTES?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  PASSWORD_RESET_TTL_MINUTES?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  EMAIL_COOLDOWN_SECONDS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMAIL_DAILY_LIMIT?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMAIL_MONTHLY_LIMIT?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMAIL_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMAIL_RETRY_BASE_MS?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  EMAIL_DEV_PREVIEW?: string;

  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;
}

/**
 * Runs in every environment, unlike validateProductionConfig() below.
 *
 * Turning email on without a working configuration is the one email failure
 * mode that must never be silent. The app would boot, accept signups, then
 * fail to send the verification address those signups depend on.
 *
 * Off, meaning EMAIL_ENABLED unset or false, is always valid. That's local
 * development, and email.service.ts logs whatever it would have sent.
 *
 * No message below interpolates a secret. The key gets checked, never
 * echoed.
 */
function validateEmailConfig(config: EnvironmentVariables): void {
  if (config.EMAIL_ENABLED !== 'true') {
    return;
  }

  const problems: string[] = [];
  const apiKey = config.RESEND_API_KEY?.trim();

  if (!apiKey) {
    problems.push(
      'RESEND_API_KEY is required when EMAIL_ENABLED=true — set it, or set EMAIL_ENABLED=false to log emails instead of sending them',
    );
  } else if (apiKey.startsWith('re_your') || apiKey.includes('change-me') || apiKey === 're_') {
    // The .env.example placeholder, copied across verbatim. Caught here
    // because Resend's own rejection ("invalid_api_key") arrives per-send,
    // hours after boot, attached to a user who never got their email.
    problems.push('RESEND_API_KEY still holds a placeholder value — paste the real key from the Resend dashboard');
  }

  if (!config.RESEND_FROM_EMAIL?.includes('@')) {
    problems.push(
      'RESEND_FROM_EMAIL must be a full address on a domain verified in Resend, e.g. hello@mail.ravenstack.online (see docs/email.md#domains)',
    );
  }

  if (config.NODE_ENV === 'production') {
    if (!config.APP_URL) {
      problems.push(
        'APP_URL is required in production when email is enabled — verification and password-reset links are built from it',
      );
    } else if (!config.APP_URL.startsWith('https://')) {
      problems.push('APP_URL must use https:// in production — password-reset links travel over it');
    } else if (/localhost|127\.0\.0\.1/.test(config.APP_URL)) {
      problems.push('APP_URL must be the real dashboard origin in production, not localhost');
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid email configuration: ${problems.join('; ')}`);
  }
}

/**
 * Runs in every environment, same reasoning as validateEmailConfig(): a
 * provider with an id but no secret would render a "Continue with GitHub"
 * button that can never complete, and the failure would surface as a
 * confusing provider-side error minutes later instead of at boot.
 *
 * Both unset is always valid — the provider is simply off and the dashboard
 * hides its button.
 */
function validateOAuthConfig(config: EnvironmentVariables): void {
  const problems: string[] = [];

  const providers = [
    {
      name: 'GitHub',
      id: config.GITHUB_CLIENT_ID,
      secret: config.GITHUB_CLIENT_SECRET,
      callback: config.GITHUB_CALLBACK_URL,
      idVar: 'GITHUB_CLIENT_ID',
      secretVar: 'GITHUB_CLIENT_SECRET',
      callbackVar: 'GITHUB_CALLBACK_URL',
    },
    {
      name: 'Google',
      id: config.GOOGLE_CLIENT_ID,
      secret: config.GOOGLE_CLIENT_SECRET,
      callback: config.GOOGLE_CALLBACK_URL,
      idVar: 'GOOGLE_CLIENT_ID',
      secretVar: 'GOOGLE_CLIENT_SECRET',
      callbackVar: 'GOOGLE_CALLBACK_URL',
    },
  ];

  for (const p of providers) {
    const id = p.id?.trim();
    const secret = p.secret?.trim();
    if (!id && !secret) {
      continue; // provider off
    }
    if (!id) {
      problems.push(
        `${p.idVar} is required when ${p.secretVar} is set — set both, or neither to disable ${p.name} sign-in`,
      );
    }
    if (!secret) {
      problems.push(
        `${p.secretVar} is required when ${p.idVar} is set — set both, or neither to disable ${p.name} sign-in`,
      );
    } else if (secret.includes('change-me') || secret.includes('your-')) {
      problems.push(
        `${p.secretVar} still holds a placeholder value — paste the real client secret from the ${p.name} OAuth app`,
      );
    }
    if (config.NODE_ENV === 'production') {
      const callback = p.callback ?? (config.APP_URL ? `${config.APP_URL}/api/auth/oauth/callback` : undefined);
      if (!callback) {
        problems.push(
          `${p.callbackVar} (or APP_URL to derive it from) is required in production when ${p.name} sign-in is enabled`,
        );
      } else if (!callback.startsWith('https://')) {
        problems.push(`${p.callbackVar} must use https:// in production — authorization codes travel on it`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid OAuth configuration: ${problems.join('; ')}`);
  }
}

/**
 * Extra checks that only apply once NODE_ENV=production. Local dev should
 * never crash on these. A misconfigured prod deploy should never start.
 */
function validateProductionConfig(config: EnvironmentVariables): void {
  if (config.NODE_ENV !== 'production') {
    return;
  }

  const problems: string[] = [];

  if (!config.TURN_TLS_PORT) {
    problems.push(
      'TURN_TLS_PORT is required in production — TURNS/DTLS needs a real certificate configured on coturn (see docs/turn.md#tls)',
    );
  }
  if (!config.CORS_ORIGIN || config.CORS_ORIGIN === '*') {
    problems.push('CORS_ORIGIN must not be "*" in production — set explicit allowed origins');
  }
  if (config.TURN_HOST === 'localhost' || config.TURN_HOST === '127.0.0.1') {
    problems.push('TURN_HOST must be a real public hostname in production, not "localhost"');
  }
  if (!config.RTC_TOKEN_SECRET) {
    problems.push(
      'RTC_TOKEN_SECRET is required in production — RTC tokens must not share a signing key with dashboard session JWTs (see docs/rtc/security.md)',
    );
  } else if (config.RTC_TOKEN_SECRET === config.JWT_SECRET) {
    problems.push('RTC_TOKEN_SECRET must differ from JWT_SECRET — they authorize different things');
  } else if (config.RTC_TOKEN_SECRET === config.CHAT_TOKEN_SECRET) {
    problems.push(
      'RTC_TOKEN_SECRET must differ from CHAT_TOKEN_SECRET — a leaked chat key must not mint media credentials',
    );
  }
  if (!config.SFU_REGISTRATION_SECRET) {
    problems.push(
      'SFU_REGISTRATION_SECRET is required in production — otherwise any host that can reach the API can register itself as an RTC server (see docs/rtc/security.md)',
    );
  } else if (config.SFU_REGISTRATION_SECRET === config.RTC_TOKEN_SECRET) {
    problems.push(
      'SFU_REGISTRATION_SECRET must differ from RTC_TOKEN_SECRET — a leaked client token key must not let an attacker join the SFU fleet',
    );
  }
  if (config.RTC_SIGNALING_URL?.startsWith('ws://')) {
    problems.push('RTC_SIGNALING_URL must use wss:// (TLS) in production, not ws:// — RTC tokens travel on it');
  }
  if (!config.CHAT_TOKEN_SECRET) {
    problems.push(
      'CHAT_TOKEN_SECRET is required in production — chat tokens must not share a signing key with dashboard session JWTs (see docs/chat/websocket.md#authentication)',
    );
  } else if (config.CHAT_TOKEN_SECRET === config.JWT_SECRET) {
    problems.push('CHAT_TOKEN_SECRET must differ from JWT_SECRET — they authorize different things');
  }
  if (config.EMAIL_DEV_PREVIEW === 'true') {
    problems.push(
      'EMAIL_DEV_PREVIEW must not be enabled in production — it prints live verification and password-reset links to the logs',
    );
  }
  if (config.STORAGE_ENDPOINT?.startsWith('http://')) {
    problems.push(
      'STORAGE_ENDPOINT must use https:// in production — signed upload URLs would otherwise travel in cleartext',
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
  }
}

// Fails fast at boot when config is missing or malformed, rather than blow
// up confusingly on the first request that touches it.
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors.map((error) => Object.values(error.constraints ?? {}).join(', ')).join('; ');
    throw new Error(`Invalid environment configuration: ${messages}`);
  }

  validateEmailConfig(validated);
  validateOAuthConfig(validated);
  validateProductionConfig(validated);

  return validated;
}
