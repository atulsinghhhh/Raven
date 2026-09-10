import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { AuthProvider } from '../../../generated/prisma/client';
import { NotFoundError } from '../../../shared/errors/app-error';
import { RateLimit } from '../../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../../shared/rate-limit/rate-limit.guard';
import { OAuthExchangeDto } from './dto/oauth-exchange.dto';
import { OAUTH_PROVIDER_PARAM } from './oauth-providers';
import { OAuthService } from './oauth.service';

/**
 * The API half of OAuth sign-in. The browser never talks to these routes:
 * the dashboard's own server-side callback handlers do
 * (apps/dashboard/src/app/api/auth/oauth). Client secrets live only here,
 * and the tokens a provider hands back never leave this process.
 */
@ApiTags('Auth')
@Controller('v1/auth/oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Get('providers')
  @ApiOperation({
    summary: 'Which OAuth providers this deployment has configured',
    description:
      'Exactly the set of sign-in buttons the dashboard should render. Public: it reveals configuration presence, never credentials.',
  })
  @ApiResponse({ status: 200, schema: { example: { github: true, google: false } } })
  providers() {
    return this.oauthService.enabledProviders();
  }

  @Post(':provider/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(20)
  @ApiOperation({
    summary: 'Begin an OAuth sign-in',
    description:
      'Mints a single-use state (10-minute TTL) and returns the provider authorization URL to redirect the browser to. The caller (the dashboard) must also pin the state to the browser in an httpOnly cookie and compare it on callback.',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { authorizeUrl: 'https://github.com/login/oauth/authorize?...', state: 'nq1…' } },
  })
  @ApiResponse({ status: 501, description: 'Provider not configured on this deployment' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  start(@Param('provider') provider: string) {
    return this.oauthService.start(this.resolveProvider(provider));
  }

  @Post(':provider/exchange')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(10)
  @ApiOperation({
    summary: 'Complete an OAuth sign-in',
    description:
      'Burns the state, exchanges the authorization code with the provider server-to-server, finds or creates the Livqeno user (a returning provider account never creates a duplicate), and returns the same session shape as /login. Provider tokens are used once and discarded, never stored, never logged.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({ status: 400, description: 'Provider shared no usable email' })
  @ApiResponse({ status: 401, description: 'Invalid/expired state or the provider rejected the code' })
  @ApiResponse({ status: 403, description: 'Email owned by an existing account but unverified at the provider' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  exchange(@Param('provider') provider: string, @Body() dto: OAuthExchangeDto) {
    return this.oauthService.exchange(this.resolveProvider(provider), dto.code, dto.state);
  }

  /** 404 for anything but the two known slugs — the same shape an unknown route would give. */
  private resolveProvider(param: string): AuthProvider {
    const provider = OAUTH_PROVIDER_PARAM[param];
    if (!provider) {
      throw new NotFoundError('OAuth provider');
    }
    return provider;
  }
}
