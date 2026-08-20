import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  PieceStatus,
  Prisma,
  Review,
  ReviewItem,
  ReviewItemStatus,
  ReviewStatus,
} from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { recordAiReview } from '../../infrastructure/observability/metrics';
import { RenderLimitException, RenderService } from '../render/render.service';
import type { Layer, TemplateDocument } from '../template/template-document';
import { validatePieceData } from '../piece/piece-data';
import {
  applyOverrides,
  effectiveValue,
  sanitizeOverrides,
  type PieceOverrides,
} from '../piece/piece-overrides';
import {
  AI_REVIEW_PROVIDER,
  AiError,
  AiReviewInput,
  AiReviewProvider,
  AiLayerSummary,
} from './ai/ai-review.provider';
import { normalizeAiOutput } from './ai/ai-output';
import { runRules } from './rules/run-rules';
import {
  AI_IMAGE_MAX_SIDE,
  DEFAULT_MAX_PER_PIECE_HOUR,
  DEFAULT_MONTHLY_QUOTA,
  REVIEW_QUEUE,
  SEVERITY_ORDER,
} from './review.constants';
import type { BrandInfo, Patch, ReviewFinding } from './review.types';

const ACTIVE: ReviewStatus[] = [ReviewStatus.QUEUED, ReviewStatus.RUNNING];

const isDocument = (v: unknown): v is TemplateDocument => {
  const d = v as Partial<TemplateDocument> | null;
  return (
    !!d &&
    d.schemaVersion === 1 &&
    !!d.canvas &&
    Array.isArray(d.fields) &&
    Array.isArray(d.layers)
  );
};

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class ReviewService implements OnModuleInit {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
    private readonly config: ConfigService,
    @Inject(AI_REVIEW_PROVIDER) private readonly ai: AiReviewProvider,
    @InjectQueue(REVIEW_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    if (!this.config.get<boolean>('RUN_WORKERS', true)) return;
    try {
      const orphans = await this.prisma.review.updateMany({
        where: { status: ReviewStatus.RUNNING },
        data: {
          status: ReviewStatus.FAILED,
          errorMessage: 'El proceso se reinició durante la revisión',
          finishedAt: new Date(),
        },
      });
      if (orphans.count > 0) {
        this.logger.warn(
          `${orphans.count} revisiones huérfanas marcadas FAILED`,
        );
      }
    } catch (err) {
      this.logger.error(`Recuperación inicial falló: ${String(err)}`);
    }
  }

  // ─── settings ───────────────────────────────────────────────────────────

  async getSettings(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { aiReviewEnabled: true },
    });
    if (!ws) throw new NotFoundException('Espacio de trabajo no encontrado');
    return {
      aiEnabled: ws.aiReviewEnabled,
      aiAvailable: this.ai.isConfigured(),
    };
  }

  async updateSettings(workspaceId: string, aiEnabled: boolean) {
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { aiReviewEnabled: aiEnabled },
    });
    return this.getSettings(workspaceId);
  }

  // ─── requests ───────────────────────────────────────────────────────────

  async request(workspaceId: string, userId: string, pieceId: string) {
    const piece = await this.prisma.piece.findFirst({
      where: { id: pieceId, workspaceId },
    });
    if (!piece) throw new NotFoundException('Pieza no encontrada');
    if (piece.status === PieceStatus.ARCHIVED) {
      throw new ConflictException('La pieza está archivada');
    }

    const running = await this.prisma.review.findFirst({
      where: { pieceId, status: { in: ACTIVE } },
      orderBy: { createdAt: 'desc' },
    });
    if (running)
      return { review: this.presentReview(running, []), reused: true };

    await this.enforceLimits(workspaceId, pieceId);

    const snapshotHash = createHash('sha256')
      .update(
        JSON.stringify([
          piece.templateVersionId,
          piece.data,
          sanitizeOverrides(piece.overrides),
        ]),
      )
      .digest('hex');

    const review = await this.prisma.review.create({
      data: { workspaceId, pieceId, snapshotHash, requestedById: userId },
    });

    try {
      await this.queue.add(
        'review',
        { reviewId: review.id },
        {
          jobId: review.id,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (err) {
      await this.prisma.review.update({
        where: { id: review.id },
        data: {
          status: ReviewStatus.FAILED,
          errorMessage: 'No se pudo encolar la revisión',
          finishedAt: new Date(),
        },
      });
      this.logger.error(`Cola no disponible: ${String(err)}`);
      throw new ServiceUnavailableException(
        'El servicio de revisión no está disponible. Inténtalo en unos minutos',
      );
    }
    return { review: this.presentReview(review, []), reused: false };
  }

  async get(workspaceId: string, userId: string, reviewId: string) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, workspaceId },
      include: { items: true },
    });
    if (!review) throw new NotFoundException('Revisión no encontrada');
    return this.presentReview(review, review.items);
  }

  async listForPiece(workspaceId: string, userId: string, pieceId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { workspaceId, pieceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { items: { select: { id: true, status: true } } },
    });
    return reviews.map(({ items, ...r }) => ({
      ...this.presentReview(r, []),
      pendingCount: items.filter((i) => i.status === ReviewItemStatus.PENDING)
        .length,
      itemCount: items.length,
    }));
  }

  // ─── worker side ────────────────────────────────────────────────────────

  /**
   * Runs one review: deterministic rules first, then (when available and
   * enabled) the AI. AI problems never lose the rule findings.
   */
  async execute(reviewId: string): Promise<void> {
    const claimed = await this.prisma.review.updateMany({
      where: { id: reviewId, status: ReviewStatus.QUEUED },
      data: { status: ReviewStatus.RUNNING },
    });
    if (claimed.count === 0) return;

    try {
      const review = await this.prisma.review.findUniqueOrThrow({
        where: { id: reviewId },
      });
      const piece = await this.prisma.piece.findUniqueOrThrow({
        where: { id: review.pieceId },
        include: { templateVersion: { select: { document: true } } },
      });
      if (!isDocument(piece.templateVersion.document)) {
        throw new Error('Documento de plantilla inválido');
      }
      const doc = applyOverrides(
        piece.templateVersion.document,
        piece.overrides,
      );
      const data = piece.data as Record<string, string>;
      const brand = await this.loadBrand(review.workspaceId);

      const findings: ReviewFinding[] = runRules({ doc, data, brand });
      const ai = await this.runAi(
        review,
        doc,
        piece.overrides,
        data,
        brand,
        findings,
      );

      const all = [...findings, ...ai.findings];
      await this.prisma.$transaction([
        this.prisma.reviewItem.createMany({
          data: all.map((f) => ({
            reviewId,
            category: f.category,
            severity: f.severity,
            source: f.source,
            title: f.title,
            explanation: f.explanation,
            target: f.target ?? undefined,
            patch: (f.patch ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        }),
        this.prisma.review.update({
          where: { id: reviewId },
          data: {
            status: ReviewStatus.COMPLETED,
            aiStatus: ai.status,
            summary: ai.summary || this.defaultSummary(all.length, ai.status),
            model: ai.model,
            tokensIn: ai.tokensIn,
            tokensOut: ai.tokensOut,
            errorMessage: ai.error,
            finishedAt: new Date(),
          },
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Revisión ${reviewId} falló: ${String(err).slice(0, 300)}`,
      );
      await this.prisma.review.updateMany({
        where: { id: reviewId, status: ReviewStatus.RUNNING },
        data: {
          status: ReviewStatus.FAILED,
          errorMessage: 'No se pudo completar la revisión',
          finishedAt: new Date(),
        },
      });
    }
  }

  private async runAi(
    review: Review,
    doc: TemplateDocument,
    overrides: unknown,
    data: Record<string, string>,
    brand: BrandInfo,
    ruleFindings: ReviewFinding[],
  ): Promise<{
    status: string;
    summary: string;
    findings: ReviewFinding[];
    model: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    error: string | null;
  }> {
    const none = {
      summary: '',
      findings: [] as ReviewFinding[],
      model: null,
      tokensIn: null,
      tokensOut: null,
      error: null,
    };
    const ws = await this.prisma.workspace.findUnique({
      where: { id: review.workspaceId },
      select: { aiReviewEnabled: true },
    });
    if (!ws?.aiReviewEnabled) return { ...none, status: 'DISABLED' };
    if (!this.ai.isConfigured()) return { ...none, status: 'SKIPPED_NO_KEY' };

    try {
      const png = await this.render.renderDocument({
        workspaceId: review.workspaceId,
        doc,
        data,
        format: 'PNG',
        scale: 1,
      });
      const image = await sharp(png)
        .resize({
          width: AI_IMAGE_MAX_SIDE,
          height: AI_IMAGE_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();

      const aiStarted = Date.now();
      const result = await this.ai.review(
        this.buildAiInput(image, doc, data, brand, ruleFindings),
      );
      recordAiReview('OK', Date.now() - aiStarted);
      const norm = normalizeAiOutput(result.output, {
        doc,
        overrides,
        data,
        brand,
      });
      return {
        status: 'OK',
        summary: norm.summary,
        findings: norm.findings,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        error: null,
      };
    } catch (err) {
      const message =
        err instanceof AiError ? err.message : 'No se pudo consultar a la IA';
      recordAiReview('FAILED', 0);
      this.logger.warn({
        msg: 'AI review unavailable',
        reviewId: review.id,
        workspaceId: review.workspaceId,
        reason: message,
      });
      return { ...none, status: 'FAILED', error: message };
    }
  }

  private buildAiInput(
    image: Buffer,
    doc: TemplateDocument,
    data: Record<string, string>,
    brand: BrandInfo,
    ruleFindings: ReviewFinding[],
  ): AiReviewInput {
    const hexOf = (
      ref: { brandColorId: string } | { hex: string },
    ): string | undefined =>
      'hex' in ref
        ? ref.hex
        : brand.colors.find((c) => c.id === ref.brandColorId)?.hex;

    const layers: AiLayerSummary[] = doc.layers.map((l: Layer) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      x: Math.round(l.x),
      y: Math.round(l.y),
      width: Math.round(l.width),
      height: Math.round(l.height),
      ...(l.type === 'text'
        ? {
            text: l.bind ? (data[l.bind.fieldKey] ?? '') : l.text,
            fontSize: l.fontSize,
            fontWeight: l.fontWeight ?? 400,
            color: hexOf(l.color),
          }
        : {}),
      ...(l.type === 'shape' ? { color: hexOf(l.fill) } : {}),
      ...(l.bind ? { boundField: l.bind.fieldKey } : {}),
    }));

    return {
      imagePng: image,
      canvas: { width: doc.canvas.width, height: doc.canvas.height },
      layers,
      fields: doc.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
      })),
      data,
      brandColors: brand.colors.map((c) => ({ name: c.name, hex: c.hex })),
      ruleFindings: ruleFindings.map((f) => ({
        category: f.category,
        title: f.title,
      })),
    };
  }

  // ─── decisions ──────────────────────────────────────────────────────────

  async apply(workspaceId: string, userId: string, itemId: string) {
    const item = await this.getItem(workspaceId, itemId);
    if (item.status !== ReviewItemStatus.PENDING) {
      throw new ConflictException(
        item.status === ReviewItemStatus.STALE
          ? 'La pieza cambió desde la revisión; esta recomendación quedó obsoleta'
          : 'Esta recomendación ya fue resuelta',
      );
    }
    const patch = item.patch as Patch | null;
    if (!patch) {
      throw new BadRequestException(
        'Esta recomendación es solo un consejo; no tiene un cambio aplicable',
      );
    }

    const { piece, doc } = await this.loadPiece(item.review.pieceId);
    if (piece.status === PieceStatus.ARCHIVED) {
      throw new ConflictException('La pieza está archivada');
    }

    let pieceUpdate: Prisma.PieceUpdateInput;
    if (patch.kind === 'piece_data') {
      const data = piece.data as Record<string, string>;
      if ((data[patch.fieldKey] ?? '') !== patch.from) {
        throw await this.markStale(item.id);
      }
      const field = doc.fields.find((f) => f.key === patch.fieldKey);
      if (!field) throw await this.markStale(item.id);
      const errors = validatePieceData(
        [field],
        { [patch.fieldKey]: patch.to },
        { requireAll: false, validImageAssetIds: new Set() },
      );
      if (errors.length > 0) {
        throw new BadRequestException(errors[0].message);
      }
      pieceUpdate = { data: { ...data, [patch.fieldKey]: patch.to } };
    } else {
      if (!doc.layers.some((l) => l.id === patch.layerId)) {
        throw await this.markStale(item.id);
      }
      const current = effectiveValue(
        doc,
        piece.overrides,
        patch.layerId,
        patch.prop,
      );
      if (!sameValue(current, patch.from)) throw await this.markStale(item.id);
      const overrides = sanitizeOverrides(piece.overrides);
      overrides[patch.layerId] = {
        ...(overrides[patch.layerId] ?? {}),
        [patch.prop]: patch.to,
      };
      pieceUpdate = { overrides: overrides as Prisma.InputJsonValue };
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.piece.update({ where: { id: piece.id }, data: pieceUpdate }),
      this.prisma.reviewItem.update({
        where: { id: item.id },
        data: {
          status: ReviewItemStatus.APPLIED,
          decidedById: userId,
          decidedAt: new Date(),
        },
      }),
    ]);
    return this.presentItem(updated);
  }

  async revert(workspaceId: string, userId: string, itemId: string) {
    const item = await this.getItem(workspaceId, itemId);
    if (item.status !== ReviewItemStatus.APPLIED) {
      throw new ConflictException('Esta recomendación no está aplicada');
    }
    const patch = item.patch as Patch;
    const { piece, doc } = await this.loadPiece(item.review.pieceId);

    let pieceUpdate: Prisma.PieceUpdateInput;
    if (patch.kind === 'piece_data') {
      const data = piece.data as Record<string, string>;
      if ((data[patch.fieldKey] ?? '') !== patch.to) {
        throw new ConflictException(
          'La pieza cambió después de aplicar el cambio',
        );
      }
      pieceUpdate = { data: { ...data, [patch.fieldKey]: patch.from } };
    } else {
      const current = effectiveValue(
        doc,
        piece.overrides,
        patch.layerId,
        patch.prop,
      );
      if (!sameValue(current, patch.to)) {
        throw new ConflictException(
          'La pieza cambió después de aplicar el cambio',
        );
      }
      const overrides: PieceOverrides = sanitizeOverrides(piece.overrides);
      const layer = doc.layers.find((l) => l.id === patch.layerId);
      const original = layer
        ? (layer as unknown as Record<string, unknown>)[patch.prop]
        : undefined;
      const entry = { ...(overrides[patch.layerId] ?? {}) };
      if (sameValue(original, patch.from)) delete entry[patch.prop];
      else entry[patch.prop] = patch.from;
      if (Object.keys(entry).length === 0) delete overrides[patch.layerId];
      else overrides[patch.layerId] = entry;
      pieceUpdate = { overrides: overrides as Prisma.InputJsonValue };
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.piece.update({ where: { id: piece.id }, data: pieceUpdate }),
      this.prisma.reviewItem.update({
        where: { id: item.id },
        data: {
          status: ReviewItemStatus.PENDING,
          decidedById: null,
          decidedAt: null,
        },
      }),
    ]);
    return this.presentItem(updated);
  }

  async dismiss(workspaceId: string, userId: string, itemId: string) {
    const item = await this.getItem(workspaceId, itemId);
    if (item.status !== ReviewItemStatus.PENDING) {
      throw new ConflictException('Esta recomendación ya fue resuelta');
    }
    const updated = await this.prisma.reviewItem.update({
      where: { id: item.id },
      data: {
        status: ReviewItemStatus.DISMISSED,
        decidedById: userId,
        decidedAt: new Date(),
      },
    });
    return this.presentItem(updated);
  }

  /** Applies several items one by one; a stale one does not block the rest. */
  async applyMany(
    workspaceId: string,
    userId: string,
    reviewId: string,
    itemIds: string[],
  ) {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, workspaceId },
      select: { id: true },
    });
    if (!review) throw new NotFoundException('Revisión no encontrada');
    const owned = await this.prisma.reviewItem.findMany({
      where: { reviewId, id: { in: itemIds } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id));

    const applied: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of itemIds) {
      if (!ownedIds.has(id)) {
        failed.push({ id, reason: 'No pertenece a esta revisión' });
        continue;
      }
      try {
        await this.apply(workspaceId, userId, id);
        applied.push(id);
      } catch (err) {
        failed.push({
          id,
          reason: err instanceof Error ? err.message : 'No se pudo aplicar',
        });
      }
    }
    return { applied, failed };
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private async getItem(workspaceId: string, itemId: string) {
    const item = await this.prisma.reviewItem.findFirst({
      where: { id: itemId, review: { workspaceId } },
      include: { review: true },
    });
    if (!item) throw new NotFoundException('Recomendación no encontrada');
    return item;
  }

  private async loadPiece(pieceId: string) {
    const piece = await this.prisma.piece.findUnique({
      where: { id: pieceId },
      include: { templateVersion: { select: { document: true } } },
    });
    if (!piece || !isDocument(piece.templateVersion.document)) {
      throw new NotFoundException('Pieza no encontrada');
    }
    return { piece, doc: piece.templateVersion.document };
  }

  private async markStale(itemId: string) {
    await this.prisma.reviewItem.update({
      where: { id: itemId },
      data: { status: ReviewItemStatus.STALE },
    });
    return new ConflictException(
      'La pieza cambió desde la revisión; esta recomendación quedó obsoleta',
    );
  }

  private async loadBrand(workspaceId: string): Promise<BrandInfo> {
    const kit = await this.prisma.brandKit.findUnique({
      where: { workspaceId },
    });
    return {
      colors: (kit?.colors as BrandInfo['colors'] | undefined) ?? [],
      fonts: (kit?.fonts as BrandInfo['fonts'] | undefined) ?? [],
    };
  }

  private async enforceLimits(workspaceId: string, pieceId: string) {
    const perPiece = this.config.get<number>(
      'REVIEW_MAX_PER_PIECE_HOUR',
      DEFAULT_MAX_PER_PIECE_HOUR,
    );
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.review.findMany({
      where: { pieceId, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
      take: perPiece,
    });
    if (recent.length >= perPiece) {
      const waitMs =
        recent[0].createdAt.getTime() + 60 * 60 * 1000 - Date.now();
      throw new RenderLimitException(
        `Alcanzaste el límite de ${perPiece} revisiones por hora para esta pieza`,
        Math.max(1, Math.ceil(waitMs / 1000)),
      );
    }

    if (!this.ai.isConfigured()) return;
    const quota = this.config.get<number>(
      'REVIEW_MONTHLY_QUOTA',
      DEFAULT_MONTHLY_QUOTA,
    );
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const used = await this.prisma.review.count({
      where: { workspaceId, aiStatus: 'OK', createdAt: { gte: monthStart } },
    });
    if (used >= quota) {
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      throw new RenderLimitException(
        `El espacio alcanzó su cuota mensual de ${quota} revisiones con IA`,
        Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000)),
      );
    }
  }

  private defaultSummary(count: number, aiStatus: string): string {
    if (count === 0) return 'Todo en orden: no se encontraron problemas.';
    const base = `Se encontraron ${count} recomendaciones.`;
    return aiStatus === 'OK'
      ? base
      : `${base} La revisión con IA no estuvo disponible, solo se aplicaron las reglas automáticas.`;
  }

  private presentReview(review: Review, items: ReviewItem[]) {
    return {
      id: review.id,
      pieceId: review.pieceId,
      status: review.status,
      aiStatus: review.aiStatus,
      summary: review.summary,
      model: review.model,
      errorMessage: review.errorMessage,
      createdAt: review.createdAt,
      finishedAt: review.finishedAt,
      items: [...items]
        .sort(
          (a, b) =>
            SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map((i) => this.presentItem(i)),
    };
  }

  private presentItem(item: ReviewItem) {
    return {
      id: item.id,
      reviewId: item.reviewId,
      category: item.category,
      severity: item.severity,
      source: item.source,
      title: item.title,
      explanation: item.explanation,
      target: item.target,
      patch: item.patch,
      status: item.status,
      decidedAt: item.decidedAt,
    };
  }
}
