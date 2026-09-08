import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

const PROFILE_EXAMPLE = {
  id: 'e975bab7-93ba-48ef-8e45-d47d29bece07',
  email: 'dev@example.com',
  name: 'Dev Example',
  emailVerified: true,
  hasPassword: true,
  createdAt: '2026-09-08T10:31:00.000Z',
  authAccounts: [{ provider: 'GITHUB', email: 'dev@example.com', createdAt: '2026-09-08T10:31:00.000Z' }],
  onboarding: { completed: true, step: 7 },
};

@ApiTags('Users')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'The signed-in account',
    description:
      'Profile plus how it signs in: `hasPassword` and the linked OAuth providers, so account settings can say "connected to GitHub" without a way to read any credential. Never returns hashes or provider tokens (none are stored).',
  })
  @ApiResponse({ status: 200, schema: { example: PROFILE_EXAMPLE } })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update the signed-in account profile',
    description: 'Display name only. Email changes are not supported yet — the address is the account key.',
  })
  @ApiResponse({ status: 200, schema: { example: PROFILE_EXAMPLE } })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }
}
