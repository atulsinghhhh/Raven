import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhooksService } from './webhooks.service';
import { Capability } from '../projects/project-permissions';
import { AuditRequestContext, type AuditContext } from '../audit/audit-context.decorator';
import { AuditAction, AuditResource } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';

/**
 * Webhook management, dashboard/CLI-facing: same JWT + ownership-check
 * shape as every other developer-facing controller here. Registering a
 * delivery target is a project-configuration action, not a runtime one,
 * so it lives behind the developer's session, not an API key.
 */
@ApiTags('Webhooks')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/webhooks')
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(
    private readonly audit: AuditService,
    private readonly projectsService: ProjectsService,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Register a webhook endpoint',
    description:
      'Returns the signing secret exactly once. Verify every delivery against it — see docs/chat/webhooks.md#verifying-a-delivery.',
  })
  @ApiResponse({ status: 201, description: 'Endpoint created; signing secret returned once' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateWebhookDto,
    @AuditRequestContext() context: AuditContext,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.WebhooksManage);
    const created = await this.webhooksService.create(projectId, dto);

    await this.audit.record({
      projectId,
      actor: { id: user.id, email: user.email },
      action: AuditAction.WebhookCreated,
      resourceType: AuditResource.Webhook,
      resourceId: created.publicId,
      environment: created.environment,
      // The URL is the point of the record. The signing secret is not.
      metadata: { url: created.url, events: created.enabledEvents },
      context,
    });

    return created;
  }

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints (signing secrets are never returned)' })
  async list(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.projectsService.authorize(projectId, user.id, Capability.WebhooksRead);
    return this.webhooksService.list(projectId);
  }

  @Get(':webhookId/deliveries')
  @ApiOperation({ summary: 'Delivery log for one endpoint — attempts, status, and truncated errors' })
  @ApiNotFoundResponse({ description: 'Project or endpoint not found' })
  async listDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('webhookId') webhookId: string,
    @Query('limit') limit?: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.WebhooksRead);
    return this.webhooksService.listDeliveries(projectId, webhookId, limit ? Number(limit) : undefined);
  }

  @Patch(':webhookId')
  @ApiOperation({ summary: 'Update an endpoint, or re-enable one Livqeno auto-disabled' })
  @ApiNotFoundResponse({ description: 'Project or endpoint not found' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('webhookId') webhookId: string,
    @Body() dto: UpdateWebhookDto,
    @AuditRequestContext() context: AuditContext,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.WebhooksManage);
    const updated = await this.webhooksService.update(projectId, webhookId, dto);

    await this.audit.record({
      projectId,
      actor: { id: user.id, email: user.email },
      action: AuditAction.WebhookUpdated,
      resourceType: AuditResource.Webhook,
      resourceId: webhookId,
      metadata: { changed: Object.keys(dto) },
      context,
    });

    return updated;
  }

  @Delete(':webhookId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an endpoint and its delivery history' })
  @ApiNotFoundResponse({ description: 'Project or endpoint not found' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('webhookId') webhookId: string,
    @AuditRequestContext() context: AuditContext,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.WebhooksManage);
    await this.webhooksService.remove(projectId, webhookId);

    await this.audit.record({
      projectId,
      actor: { id: user.id, email: user.email },
      action: AuditAction.WebhookDeleted,
      resourceType: AuditResource.Webhook,
      resourceId: webhookId,
      context,
    });
  }
}
