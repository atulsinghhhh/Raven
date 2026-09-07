import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  // Only the Prisma CLI reads this (prisma.config.ts), and only a
  // transaction-mode pooler needs it — optional so a direct Postgres
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

  // Native RTC. Optional so an existing .env
  // still boots — configuration.ts falls back to JWT_SECRET for local dev.
  // What genuinely matters in production (a distinct RTC token secret) is
  // enforced in validateProductionConfig() below instead, exactly as it is
  // for CHAT_TOKEN_SECRET.
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

  // Optional — unset just means we don't advertise turns: to clients
  // (no TLS listener on coturn). Fine for local dev, not for production;
  // validateProductionConfig() below catches that case.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  TURN_TLS_PORT?: number;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  // Chat (Phase 12). All optional so a Phase 0-11 .env still boots —
  // configuration.ts supplies the defaults. The one that genuinely
  // matters in production (a distinct chat-token secret) is enforced in
  // validateProductionConfig() below instead.
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

  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;
}

/**
 * Extra checks that only apply once NODE_ENV=production. Local dev should
 * never crash on these; a misconfigured prod deploy should never start.
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
    problems.push('RTC_TOKEN_SECRET must differ from CHAT_TOKEN_SECRET — a leaked chat key must not mint media credentials');
  }
  if (!config.SFU_REGISTRATION_SECRET) {
    problems.push(
      'SFU_REGISTRATION_SECRET is required in production — otherwise any host that can reach the API can register itself as an RTC server (see docs/rtc/security.md)',
    );
  } else if (config.SFU_REGISTRATION_SECRET === config.RTC_TOKEN_SECRET) {
    problems.push('SFU_REGISTRATION_SECRET must differ from RTC_TOKEN_SECRET — a leaked client token key must not let an attacker join the SFU fleet');
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
  if (config.STORAGE_ENDPOINT?.startsWith('http://')) {
    problems.push('STORAGE_ENDPOINT must use https:// in production — signed upload URLs would otherwise travel in cleartext');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
  }
}

// Fails fast at boot if config is missing/malformed, instead of blowing
// up confusingly on the first request that touches it.
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${messages}`);
  }

  validateProductionConfig(validated);

  return validated;
}
