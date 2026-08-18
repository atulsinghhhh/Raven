import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

// Dashboard-style management, authenticated by developer session JWT.
// Every lookup here is scoped to the caller's own projects.
@ApiTags('Projects')
@ApiBearerAuth('jwt')
@Controller('v1/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the authenticated developer's projects" })
  @ApiResponse({ status: 200, description: 'Active projects owned by the caller' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.findAllForUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single project' })
  @ApiResponse({ status: 200, description: 'Project found' })
  @ApiNotFoundResponse({
    description:
      "Project doesn't exist, OR belongs to a different developer — deliberately indistinguishable, to avoid confirming another account's project ID is real.",
  })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.findOneForUser(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: 200, description: 'Project updated' })
  @ApiNotFoundResponse({ description: 'Not found, or not owned by the caller' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archive a project',
    description: 'Soft delete — sets status to ARCHIVED. The project and its history are retained, but it stops appearing in the list.',
  })
  @ApiResponse({ status: 204, description: 'Project archived' })
  @ApiNotFoundResponse({ description: 'Not found, or not owned by the caller' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.projectsService.archive(id, user.id);
  }
}
