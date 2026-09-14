import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformRoleGuard } from '../guards/platform-role.guard';
import { InfrastructureResponse, InfrastructureService } from './infrastructure.service';

/**
 * Infrastructure surface (spec §17). Read-only, no
 * `@RequirePlatformRole(...)` — same "read is open, mutation is gated"
 * convention as the rest of this slice.
 */
@ApiTags('Super Admin — Infrastructure')
@ApiBearerAuth('jwt')
@Controller('v1/super-admin/infrastructure')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
export class InfrastructureController {
  constructor(private readonly infrastructure: InfrastructureService) {}

  @Get()
  @ApiOperation({
    summary: 'API/DB/Redis/TURN/SFU dependency status, plus per-node RTC fleet detail',
    description: 'Dependency probes reuse the same checks as GET /health/ready — this is a second caller, not a second implementation.',
  })
  getInfrastructure(): Promise<InfrastructureResponse> {
    return this.infrastructure.getInfrastructure();
  }
}
