import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RenderModule } from '../render/render.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AI_REVIEW_PROVIDER } from './ai/ai-review.provider';
import { OpenAiReviewProvider } from './ai/openai-review.provider';
import { REVIEW_QUEUE } from './review.constants';
import { ReviewController } from './review.controller';
import { ReviewProcessor } from './review.processor';
import { ReviewService } from './review.service';

/**
 * Design review: deterministic rules + an AI second opinion. The AI only
 * proposes; every change is applied by the user, one recommendation at a time.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: REVIEW_QUEUE }),
    WorkspaceModule,
    RenderModule,
  ],
  controllers: [ReviewController],
  providers: [
    ReviewService,
    ReviewProcessor,
    { provide: AI_REVIEW_PROVIDER, useClass: OpenAiReviewProvider },
  ],
  exports: [ReviewService],
})
export class ReviewModule {}
