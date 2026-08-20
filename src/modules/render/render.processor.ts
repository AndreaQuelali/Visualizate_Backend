import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DEFAULT_CONCURRENCY, RENDER_QUEUE } from './render.constants';
import { RenderService } from './render.service';

// `autorun: false`: the worker only starts when RUN_WORKERS is enabled, so the
// API process can be deployed without Chromium and the worker separately.
@Processor(RENDER_QUEUE, { autorun: false })
export class RenderProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RenderProcessor.name);

  constructor(
    private readonly renderService: RenderService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  onModuleInit() {
    // Read at runtime: decorators run before ConfigModule loads the .env.
    this.worker.concurrency = this.config.get<number>(
      'RENDER_CONCURRENCY',
      DEFAULT_CONCURRENCY,
    );
    if (this.config.get<boolean>('RUN_WORKERS', true)) {
      this.worker.run().catch((err: unknown) => {
        this.logger.error(`Render worker stopped: ${String(err)}`);
      });
    }
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    await this.renderService.execute(job.data.jobId);
  }
}
