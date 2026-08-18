import { Module } from '@nestjs/common';
import { AuditController } from '../audit/audit.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ProjectMembersController } from './project-members.controller';
import { ProjectMembersService } from './project-members.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, AuditModule],
  // AuditController is a project-scoped route (it authorizes with
  // ProjectsService), so it is registered here rather than in AuditModule.
  controllers: [ProjectsController, ProjectMembersController, AuditController],
  providers: [ProjectsService, ProjectMembersService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
