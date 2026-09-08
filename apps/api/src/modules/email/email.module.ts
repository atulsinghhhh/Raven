import { Global, Module } from '@nestjs/common';
import { EmailMetricsService } from './email.metrics.service';
import { EmailService } from './email.service';
import { resendClientProvider } from './resend.provider';

/**
 * Global because email is a leaf utility that several unrelated modules
 * need (auth today, projects for member-add), and because the alternative
 * — importing it into each — makes the Resend client's "constructed once"
 * property look like an accident of module wiring rather than the point.
 *
 * It imports nothing but the globally-available ConfigModule and
 * RedisModule, which is what keeps MetricsModule → EmailModule acyclic.
 */
@Global()
@Module({
  providers: [EmailService, EmailMetricsService, resendClientProvider],
  exports: [EmailService, EmailMetricsService],
})
export class EmailModule {}
