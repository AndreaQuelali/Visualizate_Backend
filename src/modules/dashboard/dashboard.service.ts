import { Injectable, Logger } from '@nestjs/common';
import {
  PieceStatus,
  RenderFormat,
  RenderStatus,
  ReviewItemStatus,
  ReviewStatus,
  TemplateStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { QuotaService } from '../quota/quota.service';

export const DASHBOARD_RECENT_PIECES = 8;
export const DASHBOARD_TOP_TEMPLATES = 5;
export const DASHBOARD_RECENT_RENDERS = 6;
export const DASHBOARD_PENDING_REVIEWS = 6;
export const THUMBNAIL_URL_TTL_SECONDS = 300;

/**
 * A dashboard block that failed to load. Each block is resolved on its own so
 * one failing query never takes the whole dashboard down.
 */
export interface BlockError {
  error: string;
}

export type Block<T> = T | BlockError;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quota: QuotaService,
  ) {}

  async get(workspaceId: string) {
    const [
      onboarding,
      recentPieces,
      topTemplates,
      recentRenders,
      pending,
      usage,
    ] = await Promise.all([
      this.block('onboarding', () => this.onboarding(workspaceId)),
      this.block('recentPieces', () => this.recentPieces(workspaceId)),
      this.block('topTemplates', () => this.topTemplates(workspaceId)),
      this.block('recentRenders', () => this.recentRenders(workspaceId)),
      this.block('pendingReviews', () => this.pendingReviews(workspaceId)),
      this.block('usage', () => this.usage(workspaceId)),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      onboarding,
      recentPieces,
      topTemplates,
      recentRenders,
      pendingReviews: pending,
      usage,
    };
  }

  private async block<T>(
    name: string,
    load: () => Promise<T>,
  ): Promise<Block<T>> {
    try {
      return await load();
    } catch (err) {
      this.logger.error(
        `Dashboard block "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { error: 'No se pudo cargar este bloque' };
    }
  }

  private async usage(workspaceId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [usage, piecesCreated] = await Promise.all([
      this.quota.usage(workspaceId),
      this.prisma.piece.count({
        where: { workspaceId, createdAt: { gte: monthStart } },
      }),
    ]);
    return { ...usage, piecesCreatedThisMonth: piecesCreated };
  }

  private async onboarding(workspaceId: string) {
    const [brand, templates, pieces] = await Promise.all([
      this.prisma.brandKit.findUnique({
        where: { workspaceId },
        select: { id: true },
      }),
      this.prisma.template.count({
        where: { workspaceId, status: TemplateStatus.PUBLISHED },
      }),
      this.prisma.piece.count({ where: { workspaceId } }),
    ]);
    return {
      brand: brand !== null,
      template: templates > 0,
      piece: pieces > 0,
    };
  }

  private async recentPieces(workspaceId: string) {
    const pieces = await this.prisma.piece.findMany({
      where: { workspaceId, status: { not: PieceStatus.ARCHIVED } },
      orderBy: { updatedAt: 'desc' },
      take: DASHBOARD_RECENT_PIECES,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        template: { select: { name: true } },
      },
    });
    if (pieces.length === 0) return [];

    const ids = pieces.map((p) => p.id);
    const renders = await this.prisma.renderJob.findMany({
      where: {
        workspaceId,
        pieceId: { in: ids },
        format: RenderFormat.PNG,
        status: RenderStatus.SUCCEEDED,
        outputObjectKey: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { pieceId: true, outputObjectKey: true },
      take: ids.length * 3,
    });
    const latestByPiece = new Map<string, string>();
    for (const r of renders) {
      if (r.outputObjectKey && !latestByPiece.has(r.pieceId)) {
        latestByPiece.set(r.pieceId, r.outputObjectKey);
      }
    }

    return Promise.all(
      pieces.map(async (p) => {
        const key = latestByPiece.get(p.id);
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          templateName: p.template.name,
          updatedAt: p.updatedAt,
          thumbnailUrl: key
            ? await this.storage
                .getPresignedUrl(key, THUMBNAIL_URL_TTL_SECONDS)
                .catch(() => null)
            : null,
        };
      }),
    );
  }

  private async topTemplates(workspaceId: string) {
    const groups = await this.prisma.piece.groupBy({
      by: ['templateId'],
      where: { workspaceId },
      _count: { _all: true },
      orderBy: { _count: { templateId: 'desc' } },
      take: DASHBOARD_TOP_TEMPLATES,
    });
    if (groups.length === 0) return [];
    const templates = await this.prisma.template.findMany({
      where: {
        workspaceId,
        id: { in: groups.map((g) => g.templateId) },
      },
      select: { id: true, name: true },
    });
    const names = new Map(templates.map((t) => [t.id, t.name]));
    return groups
      .filter((g) => names.has(g.templateId))
      .map((g) => ({
        id: g.templateId,
        name: names.get(g.templateId) ?? '',
        piecesCount: g._count._all,
      }));
  }

  private async recentRenders(workspaceId: string) {
    const jobs = await this.prisma.renderJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_RECENT_RENDERS,
      select: {
        id: true,
        pieceId: true,
        format: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        finishedAt: true,
        piece: { select: { title: true } },
      },
    });
    return jobs.map(({ piece, ...job }) => ({
      ...job,
      pieceTitle: piece.title,
    }));
  }

  private async pendingReviews(workspaceId: string) {
    const reviews = await this.prisma.review.findMany({
      where: {
        workspaceId,
        status: ReviewStatus.COMPLETED,
        items: { some: { status: ReviewItemStatus.PENDING } },
      },
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_PENDING_REVIEWS * 3,
      select: {
        id: true,
        pieceId: true,
        createdAt: true,
        piece: { select: { title: true, status: true } },
        _count: {
          select: { items: { where: { status: ReviewItemStatus.PENDING } } },
        },
      },
    });
    // Only the latest review of each piece matters.
    const seen = new Set<string>();
    const result: {
      reviewId: string;
      pieceId: string;
      pieceTitle: string;
      pendingItems: number;
      createdAt: Date;
    }[] = [];
    for (const r of reviews) {
      if (seen.has(r.pieceId) || r.piece.status === PieceStatus.ARCHIVED) {
        continue;
      }
      seen.add(r.pieceId);
      result.push({
        reviewId: r.id,
        pieceId: r.pieceId,
        pieceTitle: r.piece.title,
        pendingItems: r._count.items,
        createdAt: r.createdAt,
      });
      if (result.length >= DASHBOARD_PENDING_REVIEWS) break;
    }
    return result;
  }
}
