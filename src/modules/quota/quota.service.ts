import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PieceStatus, RenderStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export type QuotaResource =
  'storage' | 'activePieces' | 'rendersPerMonth' | 'reviewsPerMonth';

export const DEFAULT_QUOTA_STORAGE_MB = 200;
export const DEFAULT_QUOTA_ACTIVE_PIECES = 500;
export const DEFAULT_QUOTA_RENDERS_PER_MONTH = 500;
export const DEFAULT_QUOTA_REVIEWS_PER_MONTH = 100;

/** Raised when a workspace is over a plan quota (HTTP 402). */
export class QuotaExceededException extends HttpException {
  constructor(
    readonly resource: QuotaResource,
    readonly limit: number,
    readonly used: number,
    message: string,
  ) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'QUOTA_EXCEEDED',
        resource,
        limit,
        used,
        message,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export interface QuotaMeter {
  used: number;
  limit: number;
}

export interface WorkspaceUsage {
  period: { start: string; end: string };
  storageBytes: QuotaMeter;
  activePieces: QuotaMeter;
  rendersPerMonth: QuotaMeter;
  reviewsPerMonth: QuotaMeter;
}

const BILLABLE_RENDERS: RenderStatus[] = [
  RenderStatus.QUEUED,
  RenderStatus.RUNNING,
  RenderStatus.SUCCEEDED,
];

function monthRange(now = new Date()) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

/**
 * Technical per-workspace quotas (protection against abuse). The limits come
 * from environment variables and are the same for every workspace.
 */
@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  limits() {
    return {
      storageBytes:
        this.config.get<number>('QUOTA_STORAGE_MB', DEFAULT_QUOTA_STORAGE_MB) *
        1024 *
        1024,
      activePieces: this.config.get<number>(
        'QUOTA_ACTIVE_PIECES',
        DEFAULT_QUOTA_ACTIVE_PIECES,
      ),
      rendersPerMonth: this.config.get<number>(
        'QUOTA_RENDERS_PER_MONTH',
        DEFAULT_QUOTA_RENDERS_PER_MONTH,
      ),
      reviewsPerMonth: this.config.get<number>(
        'REVIEW_MONTHLY_QUOTA',
        DEFAULT_QUOTA_REVIEWS_PER_MONTH,
      ),
    };
  }

  async usage(workspaceId: string): Promise<WorkspaceUsage> {
    const limits = this.limits();
    const { start, end } = monthRange();
    const [storage, pieces, renders, reviews] = await Promise.all([
      this.prisma.asset.aggregate({
        where: { workspaceId },
        _sum: { sizeBytes: true },
      }),
      this.prisma.piece.count({
        where: { workspaceId, status: { not: PieceStatus.ARCHIVED } },
      }),
      this.prisma.renderJob.count({
        where: {
          workspaceId,
          status: { in: BILLABLE_RENDERS },
          createdAt: { gte: start },
        },
      }),
      this.prisma.review.count({
        where: { workspaceId, aiStatus: 'OK', createdAt: { gte: start } },
      }),
    ]);
    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      storageBytes: {
        used: storage._sum.sizeBytes ?? 0,
        limit: limits.storageBytes,
      },
      activePieces: { used: pieces, limit: limits.activePieces },
      rendersPerMonth: { used: renders, limit: limits.rendersPerMonth },
      reviewsPerMonth: { used: reviews, limit: limits.reviewsPerMonth },
    };
  }

  async assertStorage(workspaceId: string, incomingBytes: number) {
    const limit = this.limits().storageBytes;
    const agg = await this.prisma.asset.aggregate({
      where: { workspaceId },
      _sum: { sizeBytes: true },
    });
    const used = agg._sum.sizeBytes ?? 0;
    if (used + incomingBytes > limit) {
      throw new QuotaExceededException(
        'storage',
        limit,
        used,
        `Se alcanzó el límite de almacenamiento de assets (${Math.round(limit / 1024 / 1024)} MB). Elimina archivos para liberar espacio`,
      );
    }
  }

  async assertActivePieces(workspaceId: string) {
    const limit = this.limits().activePieces;
    const used = await this.prisma.piece.count({
      where: { workspaceId, status: { not: PieceStatus.ARCHIVED } },
    });
    if (used >= limit) {
      throw new QuotaExceededException(
        'activePieces',
        limit,
        used,
        `Se alcanzó el límite de ${limit} piezas activas. Archiva o elimina piezas para crear nuevas`,
      );
    }
  }

  async assertMonthlyRenders(workspaceId: string) {
    const limit = this.limits().rendersPerMonth;
    const { start } = monthRange();
    const used = await this.prisma.renderJob.count({
      where: {
        workspaceId,
        status: { in: BILLABLE_RENDERS },
        createdAt: { gte: start },
      },
    });
    if (used >= limit) {
      throw new QuotaExceededException(
        'rendersPerMonth',
        limit,
        used,
        `Se alcanzó el límite de ${limit} exportaciones este mes`,
      );
    }
  }
}
