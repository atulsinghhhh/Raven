import { Module } from '@nestjs/common';
import { SuperAdminChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * `PlatformRoleGuard` and `AdminAuditService` both come from the
 * `@Global()` `SuperAdminCoreModule`, already imported once by `AppModule`
 * — nothing to import here for either.
 */
@Module({
  controllers: [SuperAdminChatController],
  providers: [ChatService],
})
export class SuperAdminChatModule {}
