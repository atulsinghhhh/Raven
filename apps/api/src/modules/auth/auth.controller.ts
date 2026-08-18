import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './jwt-payload.interface';

const AUTH_RESULT_EXAMPLE = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  expiresIn: '12h',
  user: { id: 'e975bab7-93ba-48ef-8e45-d47d29bece07', email: 'dev@example.com', name: null },
};

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit(5)
  @ApiOperation({
    summary: 'Create a developer account',
    description: 'Rate limited to 5 requests/window/IP. Passwords are hashed with bcrypt — never stored or logged in plaintext.',
  })
  @ApiResponse({ status: 201, description: 'Account created', schema: { example: AUTH_RESULT_EXAMPLE } })
  @ApiResponse({ status: 409, description: 'An account with this email already exists' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(10)
  @ApiOperation({ summary: 'Exchange email/password for a session JWT', description: 'Rate limited to 10 requests/window/IP.' })
  @ApiResponse({ status: 200, description: 'Authenticated', schema: { example: AUTH_RESULT_EXAMPLE } })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Invalidate the current session JWT',
    description: 'Blocklists this specific token (by jti) in Redis until it would have expired naturally. JWTs are stateless, so this is the only way to make one stop working before its exp claim.',
  })
  @ApiResponse({ status: 204, description: 'Logged out' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logout(user);
  }
}
