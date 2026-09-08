import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import configuration from '../../shared/config/configuration';
import { RedisModule } from '../../shared/redis/redis.module';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailType } from './email.constants';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';
import { RESEND_CLIENT } from './resend.provider';

/**
 * Wiring test, not a unit test: it builds the real module against the real
 * configuration loader, so it catches the thing a mocked ConfigService
 * cannot — that EMAIL_ENABLED actually reaches the provider factory.
 *
 * Redis is overridden rather than connected. No test in this repository
 * may open a socket, and none may hold a Resend API key.
 */
describe('EmailModule wiring', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function build() {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration], ignoreEnvFile: true }),
        RedisModule,
        EmailModule,
      ],
    })
      .overrideProvider(RedisService)
      .useValue({
        client: {
          set: jest.fn().mockResolvedValue('OK'),
          incr: jest.fn().mockResolvedValue(1),
          expire: jest.fn().mockResolvedValue(1),
        },
      })
      .compile();

    return {
      service: moduleRef.get(EmailService),
      client: moduleRef.get(RESEND_CLIENT, { strict: false }),
    };
  }

  it('starts with no Resend client when EMAIL_ENABLED is false — the default local setup', async () => {
    process.env.EMAIL_ENABLED = 'false';
    delete process.env.RESEND_API_KEY;

    const { service, client } = await build();

    expect(client).toBeNull();
    expect(service.enabled).toBe(false);
  });

  it('reports skipped, never sent, while disabled', async () => {
    process.env.EMAIL_ENABLED = 'false';

    const { service } = await build();

    await expect(
      service.send({
        to: 'dev@example.com',
        type: EmailType.Welcome,
        email: { subject: 's', html: '<p>h</p>', text: 'h' },
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
  });

  it('constructs a client once EMAIL_ENABLED=true and a key is present', async () => {
    process.env.EMAIL_ENABLED = 'true';
    // Not a real key, and never used: this test asserts on wiring and
    // sends nothing.
    process.env.RESEND_API_KEY = 'test-key-not-real';

    const { service, client } = await build();

    expect(client).not.toBeNull();
    expect(service.enabled).toBe(true);
  });

  it('stays disabled if the switch is on but no key reached the process', async () => {
    // env.validation.ts refuses this configuration at boot; the provider
    // is defensive anyway, because a null client is always safer than a
    // Resend client built from undefined.
    process.env.EMAIL_ENABLED = 'true';
    delete process.env.RESEND_API_KEY;

    const { service } = await build();

    expect(service.enabled).toBe(false);
  });

  it('exposes the dashboard origin and support address templates need', async () => {
    process.env.EMAIL_ENABLED = 'false';
    process.env.APP_URL = 'https://app.ravenstack.online';

    const { service } = await build();

    expect(service.brand).toEqual({
      appUrl: 'https://app.ravenstack.online',
      supportEmail: 'support@mail.ravenstack.online',
    });
  });
});
