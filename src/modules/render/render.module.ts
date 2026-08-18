import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { PlaywrightService } from './playwright.service';
import { RenderController } from './render.controller';
import { RENDER_QUEUE } from './render.constants';
import { RenderProcessor } from './render.processor';
import { RenderService } from './render.service';

/**
 * Asynchronous PNG/PDF export: HTTP enqueues a RenderJob, a BullMQ worker
 * renders it with headless Chromium and stores the file in object storage.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: RENDER_QUEUE }),
    StorageModule,
    WorkspaceModule,
  ],
  controllers: [RenderController],
  providers: [RenderService, RenderProcessor, PlaywrightService],
  exports: [RenderService],
})
export class RenderModule {}
