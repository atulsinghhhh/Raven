import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { Capability } from '../projects/project-permissions';
import { ProjectsService } from '../projects/projects.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * A developer's own notifications for one project (Phase 5F). Same JWT +
 * membership-check shape as every other project-scoped controller here.
 *
 * Every method resolves the recipient from `@CurrentUser()` — never from a
 * request body or query param — so there is no way to ask for, or mark
 * read, another member's notifications by supplying their id (spec §10).
 * `Capability.ProjectRead` is the gate, not a narrower capability: every
 * role has it, and a notification is personal to the developer reading
 * it, not a privileged view of project state the way, say, billing is.
 */
@ApiTags('Notifications')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the caller's own notifications for this project, newest first" })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListNotificationsDto,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.notifications.list(user.id, projectId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: "The caller's unread notification count for this project" })
  async unreadCount(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    const count = await this.notifications.unreadCount(user.id, projectId);
    return { count };
  }

  @Patch(':notificationId/read')
  @ApiOperation({ summary: 'Mark one of the caller\'s own notifications read' })
  @ApiResponse({ status: 200, description: 'The notification, now marked read' })
  @ApiNotFoundResponse({ description: "Project not found, or the notification doesn't belong to the caller" })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('notificationId') notificationId: string,
  ) {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    return this.notifications.markRead(user.id, projectId, notificationId);
  }

  @Post('read-all')
  @HttpCode(204)
  @ApiOperation({ summary: "Mark every one of the caller's unread notifications for this project read" })
  async markAllRead(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string): Promise<void> {
    await this.projectsService.authorize(projectId, user.id, Capability.ProjectRead);
    await this.notifications.markAllRead(user.id, projectId);
  }
}
