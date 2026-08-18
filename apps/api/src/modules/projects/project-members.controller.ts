import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddProjectMemberDto, UpdateProjectMemberDto } from './dto/project-member.dto';
import { ProjectMembersService } from './project-members.service';
import { ProjectRole } from './project-permissions';

@ApiTags('Project Members')
@ApiBearerAuth('jwt')
@Controller('v1/projects/:projectId/members')
@UseGuards(JwtAuthGuard)
export class ProjectMembersController {
  constructor(private readonly members: ProjectMembersService) {}

  @Get()
  @ApiOperation({
    summary: "List a project's members and what each of them may do",
    description:
      'Each member carries the capability list their role grants, so a dashboard can hide actions it would only be refused for.',
  })
  @ApiNotFoundResponse({ description: 'Project not found, or you are not a member of it' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.members.list(projectId, user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add an existing Raven user to this project',
    description:
      'Requires members:manage. Granting the owner role requires being an owner — otherwise an admin could promote themselves and demote the actual owner.',
  })
  @ApiForbiddenResponse({ description: 'Your role does not allow managing members, or granting this role' })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.members.add(projectId, user.id, {
      email: dto.email,
      role: dto.role ?? ProjectRole.DEVELOPER,
    });
  }

  @Patch(':userId')
  @ApiOperation({
    summary: "Change a member's role",
    description:
      "A project always keeps at least one owner: demoting the last one is refused, because a project with no owner cannot be administered by anyone.",
  })
  @ApiForbiddenResponse({ description: 'Your role does not allow this change' })
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.members.updateRole(projectId, user.id, userId, dto.role);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Remove a member from this project' })
  @ApiForbiddenResponse({ description: 'Your role does not allow removing this member' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.members.remove(projectId, user.id, userId);
  }
}
