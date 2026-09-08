import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * DI token for the one Resend client in the process.
 *
 * `new Resend(...)` appears exactly here and nowhere else. Every send goes
 * through EmailService, so there is one place that knows the key, one
 * place that classifies errors, and one place that counts against the
 * free tier.
 */
export const RESEND_CLIENT = 'RESEND_CLIENT';

/** What EmailService actually needs. Narrower than the SDK's own surface,
 * so a test fake is four lines rather than a mock of the whole client. */
export interface ResendEmailClient {
  emails: {
    send(
      payload: {
        from: string;
        to: string | string[];
        subject: string;
        html: string;
        text: string;
        replyTo?: string | string[];
      },
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: { name: string; message: string; statusCode: number | null } | null;
    }>;
  };
}

/**
 * Null when email is disabled or unconfigured — which is the normal state
 * of a fresh clone, and the state every test runs in. EmailService checks
 * for null and logs what it would have sent; it never fabricates a
 * successful delivery.
 *
 * "Enabled with no key" cannot reach here: validateEmailConfig() in
 * env.validation.ts fails the boot first, with a message that names the
 * variable.
 */
export const resendClientProvider: Provider = {
  provide: RESEND_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): ResendEmailClient | null => {
    const enabled = configService.get<boolean>('email.enabled');
    const apiKey = configService.get<string>('email.apiKey');

    if (!enabled || !apiKey) {
      return null;
    }

    return new Resend(apiKey);
  },
};
