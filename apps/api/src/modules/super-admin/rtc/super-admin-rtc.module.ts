import { Module } from '@nestjs/common';
import { RtcController } from './rtc.controller';
import { RtcService } from './rtc.service';

/**
 * Registered in AppModule alongside the rest of the Super Admin Portal's
 * per-domain modules. `PrismaService` comes from the global database module
 * already imported at app root, so it doesn't need to be re-provided here.
 */
@Module({
  controllers: [RtcController],
  providers: [RtcService],
})
export class SuperAdminRtcModule {}
