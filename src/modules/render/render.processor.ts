import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DEFAULT_CONCURRENCY, RENDER_QUEUE } from './render.constants';
import { RenderService } from './render.service';

@Processor(RENDER_QUEUE)
export class RenderProcessor extends WorkerHost implements OnModuleInit {
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
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    await this.renderService.execute(job.data.jobId);
  }
}
