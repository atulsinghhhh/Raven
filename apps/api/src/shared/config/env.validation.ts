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

  @IsString()
  @IsNotEmpty()
  LIVEKIT_URL!: string;

  @IsString()
  @IsNotEmpty()
  LIVEKIT_API_KEY!: string;

  @IsString()
  @IsNotEmpty()
  LIVEKIT_API_SECRET!: string;

  @IsInt()
  @Min(1)
  RTC_TOKEN_DEFAULT_TTL_SECONDS!: number;

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
  if (config.LIVEKIT_URL.startsWith('ws://')) {
    problems.push('LIVEKIT_URL must use wss:// (TLS) in production, not ws://');
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
