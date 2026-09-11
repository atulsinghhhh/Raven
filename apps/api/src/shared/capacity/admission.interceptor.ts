import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import { AdmissionControlService, AdmissionLane } from './admission-control.service';
import { ADMISSION_LANE_KEY } from './admission.decorator';

/**
 * Applies `@Admission(lane)` to a route.
 *
 * An interceptor rather than a guard, deliberately. A guard runs *before*
 * the handler and returns a boolean, so a guard-based version would have
 * to acquire a slot and then release it from somewhere else entirely —
 * which is how slots leak. An interceptor wraps the handler, so the slot's
 * lifetime is exactly the handler's, error paths included.
 *
 * It also has to sit *inside* `RateLimitGuard` rather than outside it, and
 * Nest's ordering gives that for free: guards run before interceptors. A
 * request already over its per-key rate limit is rejected without ever
 * occupying a slot, which is the right way round — otherwise abusive
 * traffic would consume the very capacity the limiter exists to protect.
 */
@Injectable()
export class AdmissionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly admission: AdmissionControlService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const lane = this.reflector.get<AdmissionLane | undefined>(ADMISSION_LANE_KEY, context.getHandler());
    if (!lane) {
      return next.handle();
    }

    // `lastValueFrom` is what makes the slot cover the whole handler: the
    // route's promise resolves before its observable completes, so
    // releasing on the promise alone would hand the slot away while the
    // response was still being produced.
    return from(this.admission.run(lane, () => lastValueFrom(next.handle())));
  }
}
