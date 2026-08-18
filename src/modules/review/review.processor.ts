import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DEFAULT_REVIEW_CONCURRENCY, REVIEW_QUEUE } from './review.constants';
import { ReviewService } from './review.service';

@Processor(REVIEW_QUEUE)
export class ReviewProcessor extends WorkerHost implements OnModuleInit {
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
  }

  async process(job: Job<{ reviewId: string }>): Promise<void> {
    await this.reviews.execute(job.data.reviewId);
  }
}
