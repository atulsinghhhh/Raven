import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';

/** Where the compose-managed SFU listens, unless overridden. */
const DEFAULT_SFU_INTERNAL_URL = process.env.E2E_SFU_INTERNAL_URL ?? 'http://localhost:7000';

export interface LocalSfuRegistration {
  name: string;
  internalUrl: string;
}

/**
 * Registers the locally running SFU into the database this suite is using.
 *
 * # Why this is needed at all
 *
 * `GET /health` reports the RTC plane as up by picking a **registered**
 * node and probing its `/healthz`. Under LiveKit the same check probed a
 * single configured `LIVEKIT_INTERNAL_URL`, so `docker compose up -d` was
 * enough to satisfy it. It is not enough now: the fleet is
 * self-registering, and a node registers with whichever control plane its
 * own `SFU_CONTROL_PLANE_URL` points at: the compose API, reading the
 * compose database. An e2e suite running in-process against a scratch
 * database has no rows in it, so the health check correctly reports the
 * media plane as absent.
 *
 * Registering here goes through the real endpoint, with the real guard, so
 * what the health check then probes is a real Pion node answering on a
 * real port. The only thing synthesised is the registry row that the
 * compose node put in a different database.
 *
 * Throws rather than skipping when nothing is listening: a health test
 * that quietly passes without a media plane is worse than no test.
 */
export async function registerLocalSfu(
  app: INestApplication,
  overrides: { name?: string; region?: string; internalUrl?: string } = {},
): Promise<LocalSfuRegistration> {
  const internalUrl = overrides.internalUrl ?? DEFAULT_SFU_INTERNAL_URL;
  const name = overrides.name ?? 'sfu-local-01';

  // Confirm something is actually there before claiming it is, so the
  // failure names the missing container instead of surfacing later as a
  // health check that will not go green.
  let health: Response;
  try {
    health = await fetch(`${internalUrl}/healthz`, {
      signal: AbortSignal.timeout(3_000),
    });
  } catch (err) {
    throw new Error(
      `No SFU is reachable at ${internalUrl} (${(err as Error).message}).\n` +
        `Start it with: docker compose up -d sfu\n` +
        `Or point the suite elsewhere with E2E_SFU_INTERNAL_URL.`,
    );
  }
  if (!health.ok) {
    throw new Error(`SFU at ${internalUrl} answered /healthz with ${health.status}`);
  }

  const secret = app.get(ConfigService).get<string>('sfu.registrationSecret');
  if (!secret) {
    throw new Error('SFU_REGISTRATION_SECRET is not configured, so no node can be registered');
  }

  await request(app.getHttpServer())
    .post('/v1/rtc/servers/register')
    .set('Authorization', `Bearer ${secret}`)
    .send({
      name,
      region: overrides.region ?? 'local',
      // What a browser would be handed by ICE. Not used by the health
      // probe, which uses internalUrl on purpose.
      publicHost: '127.0.0.1',
      internalUrl,
      capacity: 100,
      version: 'e2e',
    })
    .expect(201);

  return { name, internalUrl };
}
