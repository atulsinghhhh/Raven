import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { CurrentScope } from '../api-keys/decorators/current-scope.decorator';
import { ProjectScope } from '../../shared/environment/environment.constants';
import { ApiKeyAuthGuard } from '../api-keys/guards/api-key-auth.guard';
import { Idempotent } from '../../shared/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../shared/idempotency/idempotency.interceptor';
import { CreateRtcTokenDto } from './dto/create-rtc-token.dto';
import { RtcTokensService } from './rtc-tokens.service';

/**
 * Shorter than IdempotencyInterceptor's default (24h): a replayed
 * response here hands back an already-minted token, and this endpoint's
 * own tokens can expire in as little as 10 minutes
 * (rtcToken.defaultTtlSeconds). Caching a replay past that point would
 * silently hand a client a dead token instead of minting a fresh one.
 */
const RTC_TOKEN_IDEMPOTENCY_TTL_SECONDS = 5 * 60;

// Issues short-lived RTC access tokens for a room. Doesn't establish a
// WebRTC session itself: the token comes back and the client SDK
// presents it to Livqeno's own signaling endpoint (`/v1/rtc`) later.
@ApiTags('RTC Tokens')
@ApiBearerAuth('apiKey')
@Controller('v1/rooms/:roomId/rtc-tokens')
@UseGuards(ApiKeyAuthGuard)
export class RtcTokensController {
  constructor(private readonly rtcTokensService: RtcTokensService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit(60)
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent(RTC_TOKEN_IDEMPOTENCY_TTL_SECONDS)
  @ApiOperation({
    summary: 'Mint a short-lived RTC access token for a participant to join this room',
    description:
      'Every token expires (ttlSeconds, max 6 hours) — there is no way to request a permanent token. Permissions are signed into the token itself and re-verified by the signaling gateway on every join; see docs/control-plane.md#rtc-tokens-ravens-permissions. Rate limited to 60 requests/window/IP. Safe to retry with the same Idempotency-Key header within 5 minutes to replay the original token instead of minting a new one.',
  })
  @ApiResponse({
    status: 201,
    description: 'Token minted',
    schema: {
      example: {
        id: '2b45e0e5-97f2-466d-b783-a09fed7f6505',
        token: 'eyJhbGciOiJIUzI1NiJ9...',
        endpoint: 'ws://localhost:7880',
        roomId: '8d86361a-7c01-4969-98cb-d0748360b803',
        roomName: 'support-room',
        participantIdentity: 'alice',
        permissions: {
          join: true,
          subscribe: true,
          publish: true,
          publishAudio: true,
          publishVideo: true,
          publishData: true,
        },
        iceServers: [
          { urls: 'stun:localhost:3478' },
          { urls: 'turn:localhost:3478?transport=udp', username: '1786980869:alice', credential: 'base64-hmac...' },
          { urls: 'turn:localhost:3478?transport=tcp', username: '1786980869:alice', credential: 'base64-hmac...' },
          { urls: 'turns:localhost:5349?transport=tcp', username: '1786980869:alice', credential: 'base64-hmac...' },
        ],
        expiresAt: '2026-08-17T15:19:49.233Z',
        createdAt: '2026-08-17T15:09:49.239Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: "Room doesn't exist, or belongs to a different project" })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  create(
    @CurrentScope() scope: ProjectScope,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateRtcTokenDto,
  ) {
    return this.rtcTokensService.create(scope, roomId, dto);
  }

  @Delete(':tokenId')
  @UseGuards(RateLimitGuard)
  @RateLimit(60)
  @ApiOperation({
    summary: 'Revoke a minted RTC token before it expires',
    description:
      'Refuses the token for any *new* signaling connection or telemetry call, which then fail with TOKEN_REVOKED. Does not disconnect a session already established on it — authorization is checked when a connection opens, not per-frame — so use DELETE /v1/rooms/:roomId to end a call in progress. Idempotent: revoking an already-revoked or already-expired token succeeds. Rate limited to 60 requests/window/IP.',
  })
  @ApiResponse({
    status: 200,
    description: 'Token revoked',
    schema: {
      example: {
        id: '2b45e0e5-97f2-466d-b783-a09fed7f6505',
        revoked: true,
        expiresAt: '2026-08-17T15:19:49.233Z',
      },
    },
  })
  @ApiNotFoundResponse({
    description:
      "Token doesn't exist, belongs to a different room, or belongs to a different project or environment",
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  revoke(
    @CurrentScope() scope: ProjectScope,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
  ) {
    return this.rtcTokensService.revoke(scope, roomId, tokenId);
  }
}
