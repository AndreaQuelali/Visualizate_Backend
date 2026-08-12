import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    DatabaseModule,
    BullModule,
    StorageModule,
    AuthModule,
    WorkspaceModule,
    BrandModule,
    AssetModule,
    TemplateModule,
    RenderModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
