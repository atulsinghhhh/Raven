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
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedUser } from './jwt-payload.interface';

const AUTH_RESULT_EXAMPLE = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  expiresIn: '12h',
  user: {
    id: 'e975bab7-93ba-48ef-8e45-d47d29bece07',
    email: 'dev@example.com',
    name: null,
    emailVerified: false,
  },
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

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(10)
  @ApiOperation({
    summary: 'Confirm an email address using the token from a verification email',
    description:
      'Unauthenticated: the link is opened from a mail client, often on another device. The token is single-use and expires (EMAIL_VERIFICATION_TTL_MINUTES). Invalid, used and expired tokens all return the same 400 — telling them apart would help someone guessing.',
  })
  @ApiResponse({ status: 200, description: 'Address confirmed', schema: { example: { email: 'dev@example.com', verifiedAt: '2026-09-08T10:31:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Link invalid, already used, or expired' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit(3)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Send another verification link to the signed-in account',
    description:
      'Takes the address from the session, never from the body — a body-supplied address would make this a way to send mail from Livqeno’s domain to anyone. Also subject to the per-recipient email cooldown (EMAIL_COOLDOWN_SECONDS) on top of this rate limit.',
  })
  @ApiResponse({ status: 202, description: 'Sent, suppressed by cooldown, or already verified' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  resendVerificationEmail(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.resendVerificationEmail(user);
  }

  @Post('password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(RateLimitGuard)
  @RateLimit(5)
  @ApiOperation({
    summary: 'Request a password-reset link',
    description:
      'Always answers 202 with the same message, whether or not an account exists — the response must not reveal which addresses are registered. Rate limited to 5/window/IP, and one email per address per EMAIL_COOLDOWN_SECONDS.',
  })
  @ApiResponse({
    status: 202,
    description: 'Accepted (identical for known and unknown addresses)',
    schema: { example: { message: 'If an account exists for that address, a password-reset link is on its way.' } },
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(5)
  @ApiOperation({
    summary: 'Set a new password using the token from a reset email',
    description:
      'Single-use token, and every other outstanding reset link for the account dies with it. Sessions issued before the reset stay valid until they expire — see docs/email.md#password-reset.',
  })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'Link invalid, already used, or expired' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
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
