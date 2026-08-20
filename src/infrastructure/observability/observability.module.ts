import {
  Controller,
  Get,
  Header,
  Headers,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  TerminusModule,
} from '@nestjs/terminus';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { Gauge } from 'prom-client';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StorageModule } from '../storage/storage.module';
import { RENDER_QUEUE } from '../../modules/render/render.constants';
import { REVIEW_QUEUE } from '../../modules/review/review.constants';
import { registry } from './metrics';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label}: sin respuesta`)),
        CHECK_TIMEOUT_MS,
      ),
    ),
  ]);
}

/** GET /health — checks PostgreSQL, Redis and MinIO; 503 if any is down. */
@ApiExcludeController()
@SkipThrottle({ ip: true, user: true })
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(RENDER_QUEUE) private readonly renderQueue: Queue,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      () =>
        this.probe('redis', async () => {
          const client = await this.renderQueue.client;
          await (client as unknown as { ping(): Promise<string> }).ping();
        }),
      () => this.probe('storage', () => this.storage.ping()),
    ]);
  }

  private async probe(key: string, run: () => Promise<unknown>) {
    const session = this.indicator.check(key);
    try {
      await withTimeout(run(), key);
      return session.up();
    } catch (err) {
      return session.down({
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** GET /metrics — Prometheus text format; optional bearer token. */
@ApiExcludeController()
@SkipThrottle({ ip: true, user: true })
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly config: ConfigService,
    @InjectQueue(RENDER_QUEUE) private readonly renderQueue: Queue,
    @InjectQueue(REVIEW_QUEUE) private readonly reviewQueue: Queue,
  ) {
    this.registerQueueGauge();
  }

  @Get()
  @Header('Content-Type', registry.contentType)
  async scrape(@Headers('authorization') authorization?: string) {
    const token = this.config.get<string>('METRICS_TOKEN');
    if (token && authorization !== `Bearer ${token}`) {
      throw new UnauthorizedException();
    }
    return registry.metrics();
  }

  private registerQueueGauge() {
    if (registry.getSingleMetric('visualizate_queue_waiting_jobs')) return;
    const queues: Record<string, Queue> = {
      render: this.renderQueue,
      review: this.reviewQueue,
    };
    new Gauge({
      name: 'visualizate_queue_waiting_jobs',
      help: 'Jobs waiting in each queue',
      labelNames: ['queue'] as const,
      registers: [registry],
      async collect() {
        for (const [name, queue] of Object.entries(queues)) {
          try {
            this.set({ queue: name }, await queue.getWaitingCount());
          } catch {
            this.set({ queue: name }, -1);
          }
        }
      },
    });
  }
}

@Module({
  imports: [
    TerminusModule,
    StorageModule,
    BullModule.registerQueue({ name: RENDER_QUEUE }, { name: REVIEW_QUEUE }),
  ],
  controllers: [HealthController, MetricsController],
})
export class ObservabilityModule {}
