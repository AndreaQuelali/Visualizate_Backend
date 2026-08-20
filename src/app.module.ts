import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './infrastructure/database/database.module';
import { BullModule } from './infrastructure/bull/bull.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { RenderModule } from './modules/render/render.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { BrandModule } from './modules/brand/brand.module';
import { AssetModule } from './modules/asset/asset.module';
import { TemplateModule } from './modules/template/template.module';
import { PieceModule } from './modules/piece/piece.module';
import { ReviewModule } from './modules/review/review.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IpThrottlerGuard } from './common/throttler.guards';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { QuotaModule } from './modules/quota/quota.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && incoming.length <= 100
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // The workspace id comes from the :id route param once routed.
          customProps: (
            req: IncomingMessage & { params?: { id?: string } },
          ) => ({
            workspaceId: req.params?.id,
          }),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: {
            ignore: (req: IncomingMessage) =>
              req.url === '/health' || req.url === '/metrics',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'ip',
            ttl: 60_000,
            limit: config.get<number>('THROTTLE_IP_LIMIT', 300),
          },
          {
            name: 'user',
            ttl: 60_000,
            limit: config.get<number>('THROTTLE_USER_LIMIT', 120),
          },
        ],
      }),
    }),
    DatabaseModule,
    ObservabilityModule,
    BullModule,
    StorageModule,
    AuthModule,
    WorkspaceModule,
    BrandModule,
    AssetModule,
    TemplateModule,
    PieceModule,
    ReviewModule,
    RenderModule,
    QuotaModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: IpThrottlerGuard }],
})
export class AppModule {}
