import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, MaxLength, Min, Max, ValidateIf } from 'class-validator';
import { UsageProduct } from '../../../../generated/prisma/enums';

/**
 * Body for `PATCH /v1/super-admin/usage/developers/:userId/allowance` — the
 * one mutating route in this slice (spec §14). `reason` is required, not
 * optional-with-a-default: "admins must not silently modify developer
 * limits" is the whole point of this endpoint existing, so a missing
 * reason is a 400, not a blank audit entry.
 *
 * Exactly one of `includedMinutes`/`includedCount` is meaningful, and which
 * one depends on `product`: RTC and LIVE_STREAMING are duration-based
 * (`includedMinutes`, matching `UsageAllowance.includedMinutes`), CHAT is
 * count-based (`includedCount`). `@ValidateIf` enforces that the field
 * matching `product` is present; the service re-checks this regardless
 * (belt and suspenders — a raw request bypassing class-validator would
 * otherwise reach a silent no-op update).
 */
export class UpdateAllowanceDto {
  @ApiProperty({ enum: UsageProduct, description: 'Which allowance pool to change.' })
  @IsEnum(UsageProduct)
  product!: UsageProduct;

  @ApiPropertyOptional({
    description: 'New included-minutes grant. Required when product is RTC or LIVE_STREAMING, ignored for CHAT.',
    minimum: 0,
  })
  @ValidateIf((o: UpdateAllowanceDto) => o.product !== UsageProduct.CHAT)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  includedMinutes?: number;

  @ApiPropertyOptional({
    description: 'New included-message-count grant. Required when product is CHAT, ignored otherwise.',
    minimum: 0,
  })
  @ValidateIf((o: UpdateAllowanceDto) => o.product === UsageProduct.CHAT)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  includedCount?: number;

  @ApiProperty({
    description:
      'Why this limit is being changed. Required — every allowance edit is written to the admin audit log with this text attached.',
    maxLength: 500,
  })
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
