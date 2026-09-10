import { SetMetadata } from '@nestjs/common';
import { AdmissionLane } from './admission-control.service';

export const ADMISSION_LANE_KEY = 'raven:admission-lane';

/**
 * Runs this route under a named admission lane's concurrency ceiling.
 *
 * Put it on handlers whose cost is dominated by database work, which is
 * what the ceiling is protecting. A read served from Redis, or a handler
 * that does no I/O at all, gains nothing from being queued behind one and
 * would only make the ceiling look busier than the pool actually is.
 *
 * Pairs with, and does not replace, `@RateLimit`. See
 * `AdmissionControlService` for why a deployment wants both.
 */
export const Admission = (lane: AdmissionLane) => SetMetadata(ADMISSION_LANE_KEY, lane);
