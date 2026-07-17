import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // expiresIn as number = seconds (86400 = 1 day)
          expiresIn: config.get<number>('JWT_EXPIRES_IN_SECONDS', 86400),
        },
      }),
    }),
  ],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}
