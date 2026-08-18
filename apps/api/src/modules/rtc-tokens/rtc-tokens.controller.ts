import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
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
import { CurrentProjectId } from '../api-keys/decorators/current-project-id.decorator';
import { ApiKeyAuthGuard } from '../api-keys/guards/api-key-auth.guard';
import { CreateRtcTokenDto } from './dto/create-rtc-token.dto';
import { RtcTokensService } from './rtc-tokens.service';

// Issues short-lived RTC access tokens for a room. Doesn't establish a
// WebRTC session itself — the token comes back and the client SDK
// presents it to LiveKit's signaling endpoint later.
@ApiTags('RTC Tokens')
@ApiBearerAuth('apiKey')
@Controller('v1/rooms/:roomId/rtc-tokens')
@UseGuards(ApiKeyAuthGuard)
export class RtcTokensController {
  constructor(private readonly rtcTokensService: RtcTokensService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit(60)
  @ApiOperation({
    summary: 'Mint a short-lived RTC access token for a participant to join this room',
    description:
      'Every token expires (ttlSeconds, max 6 hours) — there is no way to request a permanent token. Permissions are translated into a LiveKit access token grant; see docs/control-plane.md#rtc-tokens-ravens-permissions--livekits-grant. Rate limited to 60 requests/window/IP.',
  })
  @ApiResponse({
    status: 201,
    description: 'Token minted',
    schema: {
      example: {
        id: '2b45e0e5-97f2-466d-b783-a09fed7f6505',
        token: 'eyJhbGciOiJIUzI1NiJ9...',
        livekitUrl: 'ws://localhost:7880',
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
    @CurrentProjectId() projectId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateRtcTokenDto,
  ) {
    return this.rtcTokensService.create(projectId, roomId, dto);
  }
}
