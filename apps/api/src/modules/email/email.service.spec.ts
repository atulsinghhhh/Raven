import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../shared/redis/redis.service';
import { EmailType } from './email.constants';
import { EmailMetricsService } from './email.metrics.service';
import { EmailService, classifyResendError } from './email.service';
import { ResendEmailClient } from './resend.provider';

const CONFIG: Record<string, unknown> = {
  env: 'test',
  appUrl: 'https://app.ravenstack.online',
  'email.enabled': true,
  'email.apiKey': 're_test_key_never_real',
  'email.fromEmail': 'hello@mail.ravenstack.online',
  'email.fromName': 'Raven',
  'email.replyTo': undefined,
  'email.supportEmail': 'support@mail.ravenstack.online',
  'email.docsUrl': 'https://docs.ravenstack.online',
  'email.cooldownSeconds': 60,
  'email.dailyLimit': 100,
  'email.monthlyLimit': 3000,
  'email.maxAttempts': 3,
  // Zero backoff: these tests exercise the retry *decision*, and real
  // sleeps would only make the suite slow.
  'email.retryBaseMs': 0,
  'email.devPreview': false,
};

const RENDERED = {
  subject: 'Confirm your Raven email address',
  html: '<p>hello</p>',
  text: 'hello',
};

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values = { ...CONFIG, ...overrides };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function makeRedis() {
  return {
    client: {
      // Cooldown free by default: SET NX returns OK when the key was unset.
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    },
  };
}

function makeClient(send: jest.Mock): ResendEmailClient {
  return { emails: { send } } as unknown as ResendEmailClient;
}

const ok = jest.fn().mockResolvedValue({ data: { id: 'msg_123' }, error: null });

function build(options: {
  send?: jest.Mock;
  config?: Record<string, unknown>;
  redis?: ReturnType<typeof makeRedis>;
  client?: ResendEmailClient | null;
}) {
  const redis = options.redis ?? makeRedis();
  const send = options.send ?? ok;
  const client =
    options.client === undefined ? makeClient(send) : options.client;
  const service = new EmailService(
    makeConfig(options.config),
    redis as unknown as RedisService,
    new EmailMetricsService(),
    client,
  );
  return { service, redis, send };
}

const input = {
  to: 'dev@example.com',
  type: EmailType.EmailVerification,
  email: RENDERED,
};

describe('EmailService', () => {
  describe('when email is disabled', () => {
    it('reports skipped rather than a fake success, and never calls Resend', async () => {
      const send = jest.fn();
      const { service } = build({ client: null, send });

      const result = await service.send(input);

      expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
      expect(send).not.toHaveBeenCalled();
    });

    it('does not print the message body unless EMAIL_DEV_PREVIEW is on', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service } = build({ client: null });

      await service.send({ ...input, email: { ...RENDERED, text: 'https://app/verify?token=SECRET' } });

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('sending', () => {
    it('sends to the right recipient, from the configured identity, with both parts', async () => {
      const send = jest.fn().mockResolvedValue({ data: { id: 'msg_abc' }, error: null });
      const { service } = build({ send });

      const result = await service.send(input);

      expect(result).toEqual({ status: 'sent', messageId: 'msg_abc' });
      const [payload] = send.mock.calls[0];
      expect(payload).toMatchObject({
        to: 'dev@example.com',
        from: 'Raven <hello@mail.ravenstack.online>',
        subject: RENDERED.subject,
        html: RENDERED.html,
        text: RENDERED.text,
      });
    });

    it('omits replyTo entirely when none is configured, rather than sending undefined', async () => {
      const send = jest.fn().mockResolvedValue({ data: { id: 'm' }, error: null });
      const { service } = build({ send });

      await service.send(input);

      expect(Object.keys(send.mock.calls[0][0])).not.toContain('replyTo');
    });

    it('passes an idempotency key through when the caller supplies one', async () => {
      const send = jest.fn().mockResolvedValue({ data: { id: 'm' }, error: null });
      const { service } = build({ send });

      await service.send({ ...input, idempotencyKey: 'verify-u1' });

      expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'verify-u1' });
    });
  });

  describe('free-tier protection', () => {
    it('suppresses a second email of the same type to the same recipient inside the cooldown', async () => {
      const redis = makeRedis();
      redis.client.set.mockResolvedValue(null); // SET NX found the key already there
      const send = jest.fn();
      const { service } = build({ redis, send });

      const result = await service.send(input);

      expect(result).toEqual({ status: 'skipped', reason: 'cooldown' });
      expect(send).not.toHaveBeenCalled();
    });

    it('keys the cooldown on a hash, never the raw address', async () => {
      const redis = makeRedis();
      const { service } = build({ redis });

      await service.send(input);

      const [key] = redis.client.set.mock.calls[0];
      expect(key).toContain(EmailType.EmailVerification);
      expect(key).not.toContain('dev@example.com');
    });

    it('does not apply a cooldown when the caller opts out (security notifications)', async () => {
      const redis = makeRedis();
      const send = jest.fn().mockResolvedValue({ data: { id: 'm' }, error: null });
      const { service } = build({ redis, send });

      await service.send({ ...input, cooldown: false });

      expect(redis.client.set).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalled();
    });

    it('stops at the daily cap before calling Resend', async () => {
      const redis = makeRedis();
      redis.client.incr
        .mockResolvedValueOnce(10) // monthly, fine
        .mockResolvedValueOnce(101); // daily, over
      const send = jest.fn();
      const { service } = build({ redis, send });

      const result = await service.send(input);

      expect(result).toEqual({ status: 'skipped', reason: 'daily_quota' });
      expect(send).not.toHaveBeenCalled();
    });

    it('stops at the monthly cap before spending a daily slot', async () => {
      const redis = makeRedis();
      redis.client.incr.mockResolvedValueOnce(3001);
      const send = jest.fn();
      const { service } = build({ redis, send });

      const result = await service.send(input);

      expect(result).toEqual({ status: 'skipped', reason: 'monthly_quota' });
      expect(redis.client.incr).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    it('fails open when Redis is down — a reset email matters more than a counter', async () => {
      const redis = makeRedis();
      redis.client.set.mockRejectedValue(new Error('redis down'));
      redis.client.incr.mockRejectedValue(new Error('redis down'));
      const send = jest.fn().mockResolvedValue({ data: { id: 'm' }, error: null });
      const { service } = build({ redis, send });

      const result = await service.send(input);

      expect(result.status).toBe('sent');
    });
  });

  describe('error handling', () => {
    it('does not retry a permanent failure', async () => {
      const send = jest.fn().mockResolvedValue({
        data: null,
        error: { name: 'invalid_from_address', message: 'domain is not verified', statusCode: 403 },
      });
      const { service } = build({ send });

      const result = await service.send(input);

      expect(result).toMatchObject({ status: 'failed', reason: 'permanent' });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('retries a transient failure and reports success when a later attempt lands', async () => {
      const send = jest
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: { name: 'internal_server_error', message: 'oops', statusCode: 500 },
        })
        .mockResolvedValueOnce({ data: { id: 'msg_retry' }, error: null });
      const { service } = build({ send });

      const result = await service.send(input);

      expect(result).toEqual({ status: 'sent', messageId: 'msg_retry' });
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('gives up after maxAttempts instead of retrying forever', async () => {
      const send = jest.fn().mockResolvedValue({
        data: null,
        error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 },
      });
      const { service } = build({ send });

      const result = await service.send(input);

      expect(result).toMatchObject({ status: 'failed', reason: 'transient_exhausted' });
      expect(send).toHaveBeenCalledTimes(3);
    });

    it('treats a thrown network error as transient', async () => {
      const send = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ data: { id: 'msg_net' }, error: null });
      const { service } = build({ send });

      await expect(service.send(input)).resolves.toEqual({ status: 'sent', messageId: 'msg_net' });
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('reports the provider running out of quota as its own class, unretried', async () => {
      const send = jest.fn().mockResolvedValue({
        data: null,
        error: { name: 'daily_quota_exceeded', message: 'quota', statusCode: 429 },
      });
      const { service } = build({ send });

      const result = await service.send(input);

      expect(result).toMatchObject({ status: 'failed', reason: 'provider_quota' });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('never throws at the caller — auth flows must not 500 because mail is down', async () => {
      const send = jest.fn().mockRejectedValue(new Error('total outage'));
      const { service } = build({ send });

      await expect(service.send(input)).resolves.toMatchObject({ status: 'failed' });
    });
  });

  describe('secret handling', () => {
    it('keeps the API key out of every log line and every returned value', async () => {
      const lines: string[] = [];
      const spies = (['log', 'warn', 'error'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          lines.push(String(args[0]));
        }),
      );

      const send = jest.fn().mockResolvedValue({
        data: null,
        error: { name: 'invalid_api_key', message: 'API key is invalid', statusCode: 401 },
      });
      const { service } = build({ send });

      const result = await service.send(input);

      const haystack = lines.join('\n') + JSON.stringify(result);
      expect(haystack).not.toContain('re_test_key_never_real');
      spies.forEach((spy) => spy.mockRestore());
    });

    it('logs the recipient domain, never the full address', async () => {
      const lines: string[] = [];
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
        lines.push(String(args[0]));
      });

      const { service } = build({});
      await service.send(input);

      expect(lines.join('\n')).toContain('recipientDomain=example.com');
      expect(lines.join('\n')).not.toContain('dev@example.com');
      spy.mockRestore();
    });
  });
});

describe('classifyResendError', () => {
  it.each(['rate_limit_exceeded', 'internal_server_error', 'application_error'])(
    'treats %s as transient',
    (name) => {
      expect(classifyResendError(name)).toBe('transient');
    },
  );

  it.each(['validation_error', 'invalid_api_key', 'invalid_from_address', 'not_found'])(
    'treats %s as permanent',
    (name) => {
      expect(classifyResendError(name)).toBe('permanent');
    },
  );

  it.each(['daily_quota_exceeded', 'monthly_quota_exceeded'])(
    'treats %s as the provider’s own quota',
    (name) => {
      expect(classifyResendError(name)).toBe('provider_quota');
    },
  );

  it('defaults an unknown code to permanent rather than retrying blindly', () => {
    expect(classifyResendError('something_new_resend_added')).toBe('permanent');
  });
});
