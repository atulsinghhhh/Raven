import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '../../../generated/prisma/enums';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { RequirePlatformRole } from '../decorators/require-platform-role.decorator';
import { AuthenticatedPlatformAdmin, PlatformRoleGuard } from '../guards/platform-role.guard';
import { AdminsService } from './admins.service';
import { GrantAdminDto } from './dto/grant-admin.dto';
import { RevokeAdminDto } from './dto/revoke-admin.dto';

/**
 * Who holds a `PlatformRole` (spec §3/§9). Listing is open to any
 * platform role (an admin should be able to see who else has access);
 * granting and revoking are `SUPER_ADMIN`-only, since handing out
 * platform access is the single most sensitive action this portal can
 * take.
 */
@ApiTags('Super Admin — Admins')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/admins')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  @ApiOperation({ summary: 'List every user holding a platform role' })
  list() {
    return this.admins.list();
  }

  @Post()
  @RequirePlatformRole(PlatformRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Grant an existing developer a platform role',
    description: 'SUPER_ADMIN only. Finds the target by email and writes an AdminAuditLog entry in the same call.',
  })
  @ApiNotFoundResponse({ description: 'No user with this email' })
  @ApiForbiddenResponse({ description: 'Caller is not a SUPER_ADMIN' })
  grant(@Body() dto: GrantAdminDto, @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin) {
    return this.admins.grant(dto, admin);
  }

  @Delete(':userId')
  @HttpCode(204)
  @RequirePlatformRole(PlatformRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Revoke a platform role',
    description: 'SUPER_ADMIN only. A SUPER_ADMIN cannot revoke their own role through this endpoint.',
  })
  @ApiNotFoundResponse({ description: 'No platform admin with this id' })
  @ApiForbiddenResponse({ description: 'Caller is not a SUPER_ADMIN, or is attempting to revoke their own role' })
  async revoke(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RevokeAdminDto,
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
  ): Promise<void> {
    await this.admins.revoke(userId, dto.reason, admin);
  }
}
