import { Global, Module } from '@nestjs/common';
import { AdmissionControlService } from './admission-control.service';
import { AdmissionInterceptor } from './admission.interceptor';

/**
 * Admission control, available everywhere.
 *
 * Global for the same reason `PrismaModule` and `RedisModule` are: the
 * lanes are process-wide state, and a second instance of
 * `AdmissionControlService` would be a second, independent set of ceilings
 * — so two modules importing it would together admit twice what the pool
 * can serve, which is the failure this module exists to prevent.
 */
@Global()
@Module({
  providers: [AdmissionControlService, AdmissionInterceptor],
  exports: [AdmissionControlService, AdmissionInterceptor],
})
export class CapacityModule {}
