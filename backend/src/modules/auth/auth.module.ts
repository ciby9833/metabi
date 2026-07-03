import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './services/auth.service';
import { OAuthService } from './services/oauth.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from './guards/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User, EmailVerification, UserOAuthBinding } from '../../database/entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, EmailVerification, UserOAuthBinding]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('app.jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('app.jwt.expiresIn') || '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OAuthService,
    JwtStrategy,
    // 全局 JWT 守卫：所有端点默认需要登录，@Public() 例外
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, OAuthService, JwtModule, JwtStrategy],
})
export class AuthModule {}
