import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { PlatformRole } from '../../../../generated/prisma/enums';

/**
 * Grants an existing `User` a `PlatformRole` (spec §3/§9). Deliberately
 * keyed by email, not internal id: the operator granting access almost
 * always knows the developer's email, not their database uuid, and a
 * typo'd email 404s cleanly instead of silently targeting the wrong row.
 */
export class GrantAdminDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: Object.values(PlatformRole) })
  @IsEnum(PlatformRole)
  platformRole!: PlatformRole;

  @ApiProperty({ description: 'Why this admin is being granted platform access. Required — this is the most sensitive action in the portal.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
