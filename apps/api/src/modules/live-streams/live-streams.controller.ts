import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { LiveStreamStatus } from '../../generated/prisma/client';
import { ProjectScope } from '../../shared/environment/environment.constants';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../../shared/rate-limit/rate-limit.guard';
import { CurrentScope } from '../api-keys/decorators/current-scope.decorator';
import { ApiKeyAuthGuard } from '../api-keys/guards/api-key-auth.guard';
import { AddHostDto } from './dto/add-host.dto';
import { CreateLiveStreamDto } from './dto/create-live-stream.dto';
import { CreateViewerTokenDto } from './dto/create-viewer-token.dto';
import { LeaveStreamDto } from './dto/leave-stream.dto';
import { UpdateLiveStreamDto } from './dto/update-live-stream.dto';
import { LiveStreamsService } from './live-streams.service';

/**
 * Live Streaming's developer-facing surface. Every route is authenticated
 * with a project API key, same as Rooms and RTC Tokens — minting a host or
 * viewer credential is a server-to-server action your own backend takes
 * after authenticating its own user, never something a browser calls
 * directly (spec: "reuse the existing Raven token architecture").
 */
@ApiTags('Live Streaming')
@ApiBearerAuth('apiKey')
@Controller('v1/live-streams')
@UseGuards(ApiKeyAuthGuard)
export class LiveStreamsController {
  constructor(private readonly streams: LiveStreamsService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit(30)
  @ApiOperation({ summary: 'Create a live stream — a dedicated RTC room plus an attached chat conversation' })
  @ApiResponse({ status: 201, description: 'Stream created, status CREATED' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  create(@CurrentScope() scope: ProjectScope, @Body() dto: CreateLiveStreamDto) {
    return this.streams.create(scope, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the project's live streams" })
  @ApiQuery({ name: 'status', required: false, enum: LiveStreamStatus })
  @ApiResponse({ status: 200, description: 'Streams, most recent first (no live viewer counts — see GET :id)' })
  list(@CurrentScope() scope: ProjectScope, @Query('status') status?: LiveStreamStatus) {
    return this.streams.list(scope, status);
  }

  @Get(':streamId')
  @ApiOperation({ summary: 'Get a stream, including its live viewer count' })
  @ApiResponse({ status: 200, description: 'Stream found' })
  @ApiNotFoundResponse({ description: "Stream doesn't exist, or belongs to a different project" })
  get(@CurrentScope() scope: ProjectScope, @Param('streamId') streamId: string) {
    return this.streams.get(scope, streamId);
  }

  @Patch(':streamId')
  @ApiOperation({ summary: 'Update a stream\'s metadata — title, description, thumbnail, visibility, etc.' })
  @ApiResponse({ status: 200, description: 'Stream updated' })
  @ApiNotFoundResponse({ description: "Stream doesn't exist, or belongs to a different project" })
  @ApiConflictResponse({ description: 'This stream has ended and can no longer be modified' })
  update(
    @CurrentScope() scope: ProjectScope,
    @Param('streamId') streamId: string,
    @Body() dto: UpdateLiveStreamDto,
  ) {
    return this.streams.update(scope, streamId, dto);
  }

  @Post(':streamId/start')
  @ApiOperation({ summary: 'CREATED → LIVE' })
  @ApiResponse({ status: 201, description: 'Stream is now LIVE' })
  @ApiNotFoundResponse({ description: "Stream doesn't exist, or belongs to a different project" })
  @ApiConflictResponse({ description: 'Only a CREATED stream can be started' })
  start(@CurrentScope() scope: ProjectScope, @Param('streamId') streamId: string) {
    return this.streams.start(scope, streamId);
  }

  @Post(':streamId/end')
  @ApiOperation({ summary: 'LIVE → ENDED. Terminal — an ended stream cannot be restarted; create a new one.' })
  @ApiResponse({ status: 201, description: 'Stream is now ENDED' })
  @ApiNotFoundResponse({ description: "Stream doesn't exist, or belongs to a different project" })
  @ApiConflictResponse({ description: 'Only a LIVE stream can be ended' })
  end(@CurrentScope() scope: ProjectScope, @Param('streamId') streamId: string) {
    return this.streams.end(scope, streamId);
  }

  @Post(':streamId/hosts')
  @UseGuards(RateLimitGuard)
  @RateLimit(60)
  @ApiOperation({
    summary: 'Register a host/co-host and mint their RTC + chat credentials',
    description:
      'Always grants publish permissions and a moderator-or-above chat role — there is no way to call this endpoint and get viewer-only access. Call it again for the same identity to re-mint fresh credentials.',
  })
  @ApiResponse({ status: 201, description: 'Host registered, credentials minted' })
  @ApiNotFoundResponse({ description: "Stream doesn't exist, or belongs to a different project" })
  @ApiConflictResponse({ description: 'This stream has ended and can no longer be modified' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  addHost(
    @CurrentScope() scope: ProjectScope,
    @Param('streamId') streamId: string,
    @Body() dto: AddHostDto,
  ) {
    return this.streams.addHost(scope, streamId, dto);
  }

  @Delete(':streamId/hosts/:identity')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a co-host — soft removal, their history in the stream chat is preserved' })
  @ApiResponse({ status: 204, description: 'Host removed' })
  @ApiNotFoundResponse({ description: 'Stream or host not found' })
  async removeHost(
    @CurrentScope() scope: ProjectScope,
    @Param('streamId') streamId: string,
    @Param('identity') identity: string,
  ): Promise<void> {
    await this.streams.removeHost(scope, streamId, identity);
  }

  @Post(':streamId/viewer-tokens')
  @UseGuards(RateLimitGuard)
  @RateLimit(120)
  @ApiOperation({
    summary: 'Mint a viewer\'s RTC + chat credentials',
    description:
      'Always subscribe-only — there is no field on this request that can grant publish access. Call createHostCredential/addHost for that.',
  })
  @ApiResponse({ status: 201, description: 'Viewer credentials minted' })
  @ApiNotFoundResponse({ description: "Stream doesn't exist, or belongs to a different project" })
  @ApiConflictResponse({ description: 'This stream has ended and can no longer be modified' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  createViewerToken(
    @CurrentScope() scope: ProjectScope,
    @Param('streamId') streamId: string,
    @Body() dto: CreateViewerTokenDto,
  ) {
    return this.streams.createViewerToken(scope, streamId, dto.identity);
  }

  @Post(':streamId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Signal that a viewer left, for live_stream.viewer_left',
    description:
      'A clean-leave signal only — see docs/live-streaming/overview.md#known-limitations for what an abrupt disconnect does not currently trigger.',
  })
  @ApiResponse({ status: 204, description: 'Recorded' })
  @ApiNotFoundResponse({ description: "Stream doesn't exist, or belongs to a different project" })
  async leave(
    @CurrentScope() scope: ProjectScope,
    @Param('streamId') streamId: string,
    @Body() dto: LeaveStreamDto,
  ): Promise<void> {
    await this.streams.leave(scope, streamId, dto.identity);
  }
}
