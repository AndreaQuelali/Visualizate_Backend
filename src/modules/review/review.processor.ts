import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DEFAULT_REVIEW_CONCURRENCY, REVIEW_QUEUE } from './review.constants';
import { ReviewService } from './review.service';

@Processor(REVIEW_QUEUE, { autorun: false })
export class ReviewProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ReviewProcessor.name);

  constructor(
    private readonly reviews: ReviewService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  onModuleInit() {
    this.worker.concurrency = this.config.get<number>(
      'REVIEW_CONCURRENCY',
      DEFAULT_REVIEW_CONCURRENCY,
    );
    if (this.config.get<boolean>('RUN_WORKERS', true)) {
      this.worker.run().catch((err: unknown) => {
        this.logger.error(`Review worker stopped: ${String(err)}`);
      });
    }
  }

  async process(job: Job<{ reviewId: string }>): Promise<void> {
    await this.reviews.execute(job.data.reviewId);
  }
}
