import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Service only — no controller and no imports.
 *
 * The audit *route* lives in ProjectsModule instead, because it is a
 * project-scoped route that needs ProjectsService to authorize. Putting it
 * here would mean AuditModule imports ProjectsModule while ProjectsModule
 * imports AuditModule, and a forwardRef to paper over a cycle that does
 * not need to exist is worse than moving one controller.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
