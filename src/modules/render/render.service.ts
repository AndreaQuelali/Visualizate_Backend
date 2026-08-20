import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, UnrecoverableError } from 'bullmq';
import {
  AssetKind,
  Prisma,
  RenderFormat,
  RenderJob,
  RenderStatus,
  WorkspaceRole,
} from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { recordRender } from '../../infrastructure/observability/metrics';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import {
  collectAssetIds,
  FieldDef,
  TemplateDocument,
} from '../template/template-document';
import { imageAssetIds, validatePieceData } from '../piece/piece-data';
import {
  applyOverrides,
  OverrideProp,
  sanitizeOverrides,
} from '../piece/piece-overrides';
import { documentToHtml, RenderBrand } from './document-to-html';
import { PlaywrightService } from './playwright.service';
import {
  ASSET_URL_TTL_SECONDS,
  BACKOFF_MS,
  CLEANUP_INTERVAL_MS,
  DEFAULT_MAX_ACTIVE_PER_WORKSPACE,
  DEFAULT_MAX_PER_HOUR,
  DEFAULT_RETENTION_DAYS,
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_ATTEMPTS,
  MAX_OUTPUT_PIXELS,
  MAX_OUTPUT_SIDE,
  OPTIMIZE_PNG_OVER_BYTES,
  RENDER_QUEUE,
  RenderError,
} from './render.constants';

/** 429 carrying how long the client should wait. */
export class RenderLimitException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

const FINISHED: RenderStatus[] = [
  RenderStatus.SUCCEEDED,
  RenderStatus.FAILED,
  RenderStatus.CANCELLED,
];
const ACTIVE: RenderStatus[] = [RenderStatus.QUEUED, RenderStatus.RUNNING];

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

export function stableHash(parts: {
  pieceId: string;
  templateVersionId: string;
  format: RenderFormat;
  scale: number;
  data: Record<string, unknown>;
  /** Per-piece tweaks (review recommendations); part of what gets rendered. */
  overrides?: unknown;
  brandUpdatedAt: Date | null;
}): string {
  const data = Object.keys(parts.data)
    .sort()
    .map((k) => [k, parts.data[k]]);
  const overrides = sanitizeOverrides(parts.overrides);
  const overrideEntries = Object.keys(overrides)
    .sort()
    .map((id) => [
      id,
      Object.keys(overrides[id])
        .sort()
        .map((p) => [p, overrides[id][p as OverrideProp]]),
    ]);
  return createHash('sha256')
    .update(
      JSON.stringify([
        parts.pieceId,
        parts.templateVersionId,
        parts.format,
        parts.scale,
        data,
        parts.brandUpdatedAt?.toISOString() ?? null,
        overrideEntries,
      ]),
    )
    .digest('hex');
}

@Injectable()
export class RenderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RenderService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: WorkspaceAccessService,
    private readonly playwright: PlaywrightService,
    private readonly config: ConfigService,
    @InjectQueue(RENDER_QUEUE) private readonly queue: Queue,
    private readonly quota: QuotaService,
  ) {}

  // ─── lifecycle ──────────────────────────────────────────────────────────

  async onModuleInit() {
    const runsWorkers = this.config.get<boolean>('RUN_WORKERS', true);
    try {
      const orphans = runsWorkers
        ? await this.prisma.renderJob.updateMany({
            where: { status: RenderStatus.RUNNING },
            data: {
              status: RenderStatus.FAILED,
              errorCode: 'WORKER_LOST',
              errorMessage:
                'El proceso de render se reinició durante el trabajo',
              finishedAt: new Date(),
            },
          })
        : { count: 0 };
      if (orphans.count > 0) {
        this.logger.warn(`${orphans.count} trabajos huérfanos marcados FAILED`);
      }
      await this.cleanupExpired();
    } catch (err) {
      this.logger.error(`Recuperación inicial falló: ${String(err)}`);
    }
    this.timer = setInterval(() => {
      void this.cleanupExpired().catch((err: unknown) =>
        this.logger.error(`Limpieza falló: ${String(err)}`),
      );
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── public API ─────────────────────────────────────────────────────────

  async request(
    workspaceId: string,
    userId: string,
    pieceId: string,
    dto: { format: RenderFormat; scale?: number },
  ) {
    const piece = await this.prisma.piece.findFirst({
      where: { id: pieceId, workspaceId },
      include: { templateVersion: { select: { document: true } } },
    });
    if (!piece) throw new NotFoundException('Pieza no encontrada');
    if (piece.status !== 'READY') {
      throw new BadRequestException(
        'La pieza debe estar marcada como lista para exportarla',
      );
    }
    const doc = piece.templateVersion.document;
    if (!isDocument(doc)) {
      throw new BadRequestException(
        'El documento de la plantilla no es válido',
      );
    }

    const scale = dto.format === RenderFormat.PNG ? (dto.scale ?? 1) : 1;
    const width = doc.canvas.width * scale;
    const height = doc.canvas.height * scale;
    if (
      width > MAX_OUTPUT_SIDE ||
      height > MAX_OUTPUT_SIDE ||
      width * height > MAX_OUTPUT_PIXELS
    ) {
      throw new BadRequestException(
        'La imagen resultante sería demasiado grande. Usa una escala menor',
      );
    }

    const data = piece.data as Record<string, string>;
    await this.assertDataExportable(workspaceId, doc.fields, data);

    const brand = await this.prisma.brandKit.findUnique({
      where: { workspaceId },
      select: { updatedAt: true },
    });
    const inputHash = stableHash({
      pieceId,
      templateVersionId: piece.templateVersionId,
      format: dto.format,
      scale,
      data,
      overrides: piece.overrides,
      brandUpdatedAt: brand?.updatedAt ?? null,
    });

    const existing = await this.prisma.renderJob.findFirst({
      where: {
        pieceId,
        inputHash,
        status: { in: [RenderStatus.SUCCEEDED, ...ACTIVE] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { job: this.present(existing), reused: true };

    await this.quota.assertMonthlyRenders(workspaceId);
    await this.enforceLimits(workspaceId);

    const job = await this.prisma.renderJob.create({
      data: {
        workspaceId,
        pieceId,
        format: dto.format,
        scale,
        inputHash,
        templateVersionId: piece.templateVersionId,
        inputData: data,
        inputOverrides: sanitizeOverrides(
          piece.overrides,
        ) as Prisma.InputJsonValue,
        requestedById: userId,
      },
    });

    try {
      await this.queue.add(
        'render',
        { jobId: job.id },
        {
          jobId: job.id,
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (err) {
      await this.prisma.renderJob.update({
        where: { id: job.id },
        data: {
          status: RenderStatus.FAILED,
          errorCode: 'QUEUE_UNAVAILABLE',
          errorMessage: 'No se pudo encolar el trabajo',
          finishedAt: new Date(),
        },
      });
      this.logger.error(`Cola no disponible: ${String(err)}`);
      throw new ServiceUnavailableException(
        'El servicio de exportación no está disponible. Inténtalo en unos minutos',
      );
    }
    return { job: this.present(job), reused: false };
  }

  async get(workspaceId: string, userId: string, jobId: string) {
    return this.present(await this.getJob(workspaceId, jobId));
  }

  async listForPiece(workspaceId: string, userId: string, pieceId: string) {
    const jobs = await this.prisma.renderJob.findMany({
      where: { workspaceId, pieceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return jobs.map((j) => this.present(j));
  }

  async download(workspaceId: string, userId: string, jobId: string) {
    const job = await this.prisma.renderJob.findFirst({
      where: { id: jobId, workspaceId },
      include: { piece: { select: { title: true } } },
    });
    if (!job) throw new NotFoundException('Trabajo de render no encontrado');
    if (job.status !== RenderStatus.SUCCEEDED || !job.outputObjectKey) {
      throw new ConflictException('El archivo aún no está disponible');
    }
    const ext = job.format === RenderFormat.PNG ? 'png' : 'pdf';
    const safe =
      job.piece.title
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .trim()
        .slice(0, 80) || 'pieza';
    const filename = `${safe}.${ext}`;
    const url = await this.storage.getPresignedUrl(
      job.outputObjectKey,
      DOWNLOAD_URL_TTL_SECONDS,
      {
        'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    );
    return { url, filename, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  async cancel(workspaceId: string, userId: string, jobId: string) {
    const member = await this.access.requireMember(workspaceId, userId);
    const job = await this.getJob(workspaceId, jobId);
    if (job.requestedById !== userId && member.role !== WorkspaceRole.ADMIN) {
      throw new ConflictException(
        'Solo quien lo solicitó o un administrador puede cancelarlo',
      );
    }
    const res = await this.prisma.renderJob.updateMany({
      where: { id: jobId, status: { in: ACTIVE } },
      data: { status: RenderStatus.CANCELLED, finishedAt: new Date() },
    });
    if (res.count === 0) {
      throw new ConflictException('El trabajo ya finalizó');
    }
    await this.queue
      .getJob(jobId)
      .then((j) => j?.remove())
      .catch(() => undefined);
    return this.present(await this.getJob(workspaceId, jobId));
  }

  // ─── worker side ────────────────────────────────────────────────────────

  /**
   * Runs one job. Transient failures are rethrown so BullMQ retries with
   * backoff; permanent ones mark the job FAILED and stop retries.
   */
  async execute(jobId: string): Promise<void> {
    const job = await this.prisma.renderJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.status !== RenderStatus.QUEUED) return;

    const claimed = await this.prisma.renderJob.updateMany({
      where: { id: jobId, status: RenderStatus.QUEUED },
      data: { status: RenderStatus.RUNNING, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return;

    const started = Date.now();
    try {
      const out = await this.produce(job);
      const key = `workspaces/${job.workspaceId}/renders/${job.id}.${out.ext}`;
      await this.storage.putObject(key, out.buffer, out.mime);

      const done = await this.prisma.renderJob.updateMany({
        where: { id: jobId, status: RenderStatus.RUNNING },
        data: {
          status: RenderStatus.SUCCEEDED,
          outputObjectKey: key,
          outputBytes: out.buffer.length,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      if (done.count === 0) {
        // Cancelled while rendering: discard the output.
        await this.storage.removeObject(key).catch(() => undefined);
      } else {
        recordRender(job.format, 'SUCCEEDED', Date.now() - started);
        this.logger.log({
          msg: 'Render completed',
          jobId: job.id,
          workspaceId: job.workspaceId,
          format: job.format,
          durationMs: Date.now() - started,
        });
      }
    } catch (err) {
      const re = this.toRenderError(err);
      if (re.transient && job.attempts + 1 < MAX_ATTEMPTS) {
        await this.prisma.renderJob.updateMany({
          where: { id: jobId, status: RenderStatus.RUNNING },
          data: {
            status: RenderStatus.QUEUED,
            errorCode: re.code,
            errorMessage: re.message,
          },
        });
        throw err;
      }
      await this.prisma.renderJob.updateMany({
        where: { id: jobId, status: RenderStatus.RUNNING },
        data: {
          status: RenderStatus.FAILED,
          errorCode: re.code,
          errorMessage: re.message,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
        },
      });
      recordRender(job.format, 'FAILED', Date.now() - started);
      this.logger.error({
        msg: 'Render failed',
        jobId: job.id,
        workspaceId: job.workspaceId,
        errorCode: re.code,
      });
      throw new UnrecoverableError(re.message);
    }
  }

  /** Deletes finished jobs (and their files) older than the retention period. */
  async cleanupExpired(): Promise<number> {
    const days = this.config.get<number>(
      'RENDER_RETENTION_DAYS',
      DEFAULT_RETENTION_DAYS,
    );
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const old = await this.prisma.renderJob.findMany({
      where: { status: { in: FINISHED }, finishedAt: { lt: cutoff } },
      select: { id: true, outputObjectKey: true },
      take: 200,
    });
    for (const j of old) {
      if (j.outputObjectKey) {
        await this.storage
          .removeObject(j.outputObjectKey)
          .catch(() => undefined);
      }
    }
    if (old.length > 0) {
      await this.prisma.renderJob.deleteMany({
        where: { id: { in: old.map((j) => j.id) } },
      });
    }
    return old.length;
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async produce(job: RenderJob) {
    const version = await this.prisma.templateVersion.findUnique({
      where: { id: job.templateVersionId },
      select: { document: true },
    });
    if (!version || !isDocument(version.document)) {
      throw new RenderError(
        'INVALID_DOCUMENT',
        'El documento de la plantilla no es válido',
      );
    }
    const doc = applyOverrides(version.document, job.inputOverrides);
    const data = job.inputData as Record<string, string>;

    const format = job.format === RenderFormat.PNG ? 'PNG' : 'PDF';
    const buffer = await this.renderDocument({
      workspaceId: job.workspaceId,
      doc,
      data,
      format,
      scale: job.scale,
    });

    if (format === 'PNG') {
      let png = buffer;
      if (buffer.length > OPTIMIZE_PNG_OVER_BYTES) {
        const optimized = await sharp(buffer)
          .png({ compressionLevel: 9, effort: 7 })
          .toBuffer();
        if (optimized.length < buffer.length) png = optimized;
      }
      return { buffer: png, mime: 'image/png', ext: 'png' };
    }
    return { buffer, mime: 'application/pdf', ext: 'pdf' };
  }

  /**
   * Renders an in-memory document (overrides already applied) with headless
   * Chromium. Shared by exports and by the AI review, which needs its own
   * image of the piece.
   */
  async renderDocument(args: {
    workspaceId: string;
    doc: TemplateDocument;
    data: Record<string, string>;
    format: 'PNG' | 'PDF';
    scale: number;
  }): Promise<Buffer> {
    const { workspaceId, doc, data } = args;
    const brandKit = await this.prisma.brandKit.findUnique({
      where: { workspaceId },
    });
    const brand: RenderBrand = {
      colors: (brandKit?.colors as RenderBrand['colors'] | undefined) ?? [],
      fonts: (brandKit?.fonts as RenderBrand['fonts'] | undefined) ?? [],
    };

    const assetUrls = await this.resolveAssetUrls(workspaceId, [
      ...collectAssetIds(doc),
      ...imageAssetIds(doc.fields, data),
      ...brand.fonts.map((f) => f.assetId).filter((id): id is string => !!id),
    ]);

    const origin = this.storage.getOrigin();
    const html = documentToHtml(doc, data, {
      brand,
      assetUrls,
      allowedOrigin: origin,
    });

    return this.playwright.capture({
      html,
      width: doc.canvas.width,
      height: doc.canvas.height,
      format: args.format,
      scale: args.scale,
      allowedOrigins: [origin],
    });
  }

  private async resolveAssetUrls(workspaceId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return {};
    const assets = await this.prisma.asset.findMany({
      where: { workspaceId, id: { in: unique } },
      select: { id: true, objectKey: true },
    });
    if (assets.length !== unique.length) {
      throw new RenderError(
        'ASSET_MISSING',
        'Una imagen o fuente usada por la pieza ya no existe',
      );
    }
    const entries = await Promise.all(
      assets.map(
        async (a) =>
          [
            a.id,
            await this.storage.getPresignedUrl(
              a.objectKey,
              ASSET_URL_TTL_SECONDS,
            ),
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  private toRenderError(err: unknown): RenderError {
    if (err instanceof RenderError) return err;
    const message = err instanceof Error ? err.message : String(err);
    // Unknown failures (storage hiccups, crashes) are treated as transient.
    return new RenderError('RENDER_FAILED', message.slice(0, 300), true);
  }

  private async assertDataExportable(
    workspaceId: string,
    fields: FieldDef[],
    data: Record<string, unknown>,
  ) {
    const ids = imageAssetIds(fields, data);
    const assets =
      ids.length > 0
        ? await this.prisma.asset.findMany({
            where: {
              workspaceId,
              id: { in: ids },
              kind: { in: [AssetKind.IMAGE, AssetKind.LOGO] },
            },
            select: { id: true },
          })
        : [];
    const errors = validatePieceData(fields, data, {
      requireAll: true,
      validImageAssetIds: new Set(assets.map((a) => a.id)),
    });
    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'La pieza tiene campos con errores',
        errors,
      });
    }
  }

  private async enforceLimits(workspaceId: string) {
    const maxActive = this.config.get<number>(
      'RENDER_MAX_ACTIVE',
      DEFAULT_MAX_ACTIVE_PER_WORKSPACE,
    );
    const maxPerHour = this.config.get<number>(
      'RENDER_MAX_PER_HOUR',
      DEFAULT_MAX_PER_HOUR,
    );

    const active = await this.prisma.renderJob.count({
      where: { workspaceId, status: { in: ACTIVE } },
    });
    if (active >= maxActive) {
      throw new RenderLimitException(
        `Ya hay ${maxActive} exportaciones en curso. Espera a que terminen`,
        15,
      );
    }

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.renderJob.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
      take: maxPerHour,
    });
    if (recent.length >= maxPerHour) {
      const waitMs =
        recent[0].createdAt.getTime() + 60 * 60 * 1000 - Date.now();
      throw new RenderLimitException(
        `Alcanzaste el límite de ${maxPerHour} exportaciones por hora`,
        Math.max(1, Math.ceil(waitMs / 1000)),
      );
    }
  }

  private async getJob(workspaceId: string, jobId: string) {
    const job = await this.prisma.renderJob.findFirst({
      where: { id: jobId, workspaceId },
    });
    if (!job) throw new NotFoundException('Trabajo de render no encontrado');
    return job;
  }

  private present(job: RenderJob) {
    return {
      id: job.id,
      pieceId: job.pieceId,
      format: job.format,
      scale: job.scale,
      status: job.status,
      attempts: job.attempts,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      outputBytes: job.outputBytes,
      durationMs: job.durationMs,
      requestedById: job.requestedById,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      downloadable:
        job.status === RenderStatus.SUCCEEDED && !!job.outputObjectKey,
    };
  }
}
