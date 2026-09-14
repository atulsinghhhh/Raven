import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body for both `POST /:id/suspend` and `POST /:id/unsuspend` — identical
 * shape, so one DTO serves both routes rather than two classes that would
 * only ever differ in name. `reason` is required (400 on missing/empty)
 * because every admin mutation writes a `reason` into `AdminAuditLog`
 * (spec §9); there is no code path that can suspend or unsuspend an
 * account without one being recorded.
 */
export class SuspendDeveloperDto {
  @ApiProperty({ description: 'Why this action is being taken. Recorded verbatim in the admin audit log.' })
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(1000)
  reason!: string;
}
