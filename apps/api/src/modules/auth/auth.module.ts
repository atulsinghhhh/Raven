import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { UsageMeteringModule } from '../usage/usage-metering.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserTokensService } from './user-tokens.service';

@Module({
  imports: [
    UsersModule,
    OnboardingModule,
    // Registration provisions the account's free Raven minutes. The
    // metering module carries no module dependencies of its own, which is
    // what keeps this import from closing a cycle back through
    // ProjectsModule — see UsageMeteringModule.
    UsageMeteringModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: { expiresIn: configService.get<string>('jwt.expiresIn') },
      }),
    }),
  ],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, OAuthService, JwtStrategy, UserTokensService],
  exports: [AuthService],
})
export class AuthModule {}
