import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssetKind, Piece, PieceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { FieldDef, TemplateDocument } from '../template/template-document';
import {
  FieldError,
  imageAssetIds,
  initialData,
  PieceData,
  reconcileData,
  validatePieceData,
} from './piece-data';
import {
  CreatePieceDto,
  ListPiecesQueryDto,
  UpdatePieceDto,
} from './dto/piece.dto';

const fieldsOf = (document: unknown): FieldDef[] => {
  const doc = document as Partial<TemplateDocument> | null;
  return Array.isArray(doc?.fields) ? doc.fields : [];
};

@Injectable()
export class PieceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly storage: StorageService,
  ) {}

  async create(workspaceId: string, userId: string, dto: CreatePieceDto) {
    await this.access.requireMember(workspaceId, userId);

    const template = await this.prisma.template.findFirst({
      where: { id: dto.templateId, workspaceId },
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    if (!template.currentVersionId) {
      throw new BadRequestException(
        'La plantilla aún no está publicada. Publícala para crear piezas',
      );
    }
    if (template.status === 'ARCHIVED') {
      throw new BadRequestException('La plantilla está archivada');
    }
    const version = await this.prisma.templateVersion.findUnique({
      where: { id: template.currentVersionId },
    });
    if (!version) throw new NotFoundException('Versión no encontrada');

    const piece = await this.prisma.piece.create({
      data: {
        workspaceId,
        templateId: template.id,
        templateVersionId: version.id,
        title: dto.title.trim(),
        data: initialData(fieldsOf(version.document)),
        createdById: userId,
      },
    });
    return this.present(piece);
  }

  async list(workspaceId: string, userId: string, q: ListPiecesQueryDto) {
    await this.access.requireMember(workspaceId, userId);
    const pieces = await this.prisma.piece.findMany({
      where: {
        workspaceId,
        status: q.status ?? { not: PieceStatus.ARCHIVED },
        ...(q.templateId ? { templateId: q.templateId } : {}),
        ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        template: { select: { name: true, currentVersionId: true } },
        templateVersion: { select: { version: true } },
      },
    });
    return pieces.map(({ template, templateVersion, ...p }) => ({
      ...p,
      templateName: template.name,
      templateVersion: templateVersion.version,
      outdated:
        !!template.currentVersionId &&
        template.currentVersionId !== p.templateVersionId,
    }));
  }

  async findOne(workspaceId: string, userId: string, pieceId: string) {
    await this.access.requireMember(workspaceId, userId);
    const piece = await this.prisma.piece.findFirst({
      where: { id: pieceId, workspaceId },
      include: {
        template: { select: { name: true, currentVersionId: true } },
        templateVersion: { select: { version: true, document: true } },
      },
    });
    if (!piece) throw new NotFoundException('Pieza no encontrada');
    const { template, templateVersion, ...rest } = piece;
    return {
      ...rest,
      templateName: template.name,
      templateVersion: templateVersion.version,
      outdated:
        !!template.currentVersionId &&
        template.currentVersionId !== piece.templateVersionId,
      document: templateVersion.document,
    };
  }

  async update(
    workspaceId: string,
    userId: string,
    pieceId: string,
    dto: UpdatePieceDto,
  ) {
    await this.access.requireMember(workspaceId, userId);
    const piece = await this.getPiece(workspaceId, pieceId);
    const newStatus = dto.status ?? piece.status;

    if (
      piece.status === PieceStatus.ARCHIVED &&
      newStatus === PieceStatus.ARCHIVED &&
      dto.data !== undefined
    ) {
      throw new ConflictException(
        'La pieza está archivada. Restáurala para editarla',
      );
    }

    const data = {
      ...(piece.data as Record<string, unknown>),
      ...(dto.data ?? {}),
    };
    if (dto.data !== undefined || newStatus === PieceStatus.READY) {
      const fields = await this.versionFields(piece.templateVersionId);
      const errors = await this.validate(
        workspaceId,
        fields,
        data,
        newStatus === PieceStatus.READY,
      );
      this.throwIfErrors(errors);
    }

    const updated = await this.prisma.piece.update({
      where: { id: pieceId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        data: data as Prisma.InputJsonValue,
        status: newStatus,
      },
    });
    return this.present(updated);
  }

  async upgrade(workspaceId: string, userId: string, pieceId: string) {
    await this.access.requireMember(workspaceId, userId);
    const piece = await this.getPiece(workspaceId, pieceId);
    if (piece.status === PieceStatus.ARCHIVED) {
      throw new ConflictException('La pieza está archivada');
    }

    const template = await this.prisma.template.findUnique({
      where: { id: piece.templateId },
    });
    if (!template?.currentVersionId) {
      throw new BadRequestException('La plantilla no tiene versión publicada');
    }
    if (template.currentVersionId === piece.templateVersionId) {
      throw new BadRequestException('La pieza ya usa la última versión');
    }

    const [oldFields, newFields] = await Promise.all([
      this.versionFields(piece.templateVersionId),
      this.versionFields(template.currentVersionId),
    ]);
    const { data, dropped } = reconcileData(
      oldFields,
      newFields,
      piece.data as Record<string, unknown>,
    );

    // Drop values that no longer satisfy the new constraints.
    const softErrors = await this.validate(workspaceId, newFields, data, false);
    for (const e of softErrors) {
      data[e.field] = '';
      dropped.push(e.field);
    }

    let status = piece.status;
    if (status === PieceStatus.READY) {
      const strict = await this.validate(workspaceId, newFields, data, true);
      if (strict.length > 0) status = PieceStatus.DRAFT;
    }

    const updated = await this.prisma.piece.update({
      where: { id: pieceId },
      data: {
        templateVersionId: template.currentVersionId,
        data,
        status,
      },
    });
    return {
      piece: this.present(updated),
      dropped: [...new Set(dropped)],
      revertedToDraft: piece.status === PieceStatus.READY && status === 'DRAFT',
    };
  }

  async remove(workspaceId: string, userId: string, pieceId: string) {
    await this.access.requireMember(workspaceId, userId);
    await this.getPiece(workspaceId, pieceId);

    // Exported files live in object storage; the rows cascade with the piece.
    const outputs = await this.prisma.renderJob.findMany({
      where: { pieceId, outputObjectKey: { not: null } },
      select: { outputObjectKey: true },
    });
    await this.prisma.piece.delete({ where: { id: pieceId } });
    await Promise.all(
      outputs.map((o) =>
        this.storage
          .removeObject(o.outputObjectKey as string)
          .catch(() => undefined),
      ),
    );
    return { message: 'Pieza eliminada' };
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private present(piece: Piece) {
    return piece;
  }

  private async getPiece(workspaceId: string, pieceId: string) {
    const piece = await this.prisma.piece.findFirst({
      where: { id: pieceId, workspaceId },
    });
    if (!piece) throw new NotFoundException('Pieza no encontrada');
    return piece;
  }

  private async versionFields(versionId: string): Promise<FieldDef[]> {
    const version = await this.prisma.templateVersion.findUnique({
      where: { id: versionId },
      select: { document: true },
    });
    return fieldsOf(version?.document);
  }

  private async validate(
    workspaceId: string,
    fields: FieldDef[],
    data: Record<string, unknown>,
    requireAll: boolean,
  ): Promise<FieldError[]> {
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
    return validatePieceData(fields, data, {
      requireAll,
      validImageAssetIds: new Set(assets.map((a) => a.id)),
    });
  }

  private throwIfErrors(errors: FieldError[]) {
    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Hay campos con errores',
        errors,
      });
    }
  }
}

export type { PieceData };
