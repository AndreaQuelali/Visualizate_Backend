import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TemplateStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  EDITOR_ROLES,
  WorkspaceAccessService,
} from '../workspace/workspace-access.service';
import {
  createBlankDocument,
  collectAssetIds,
  DocumentContext,
  validateTemplateDocument,
} from './template-document';
import {
  CreateTemplateDto,
  ListTemplatesQueryDto,
  UpdateTemplateDto,
} from './dto/template.dto';

interface BrandRef {
  id?: unknown;
}

@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    query: ListTemplatesQueryDto,
  ) {
    await this.access.requireMember(workspaceId, userId);
    const templates = await this.prisma.template.findMany({
      where: {
        workspaceId,
        status: query.status ?? { not: TemplateStatus.ARCHIVED },
        ...(query.q
          ? { name: { contains: query.q, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, version: true, publishedAt: true },
        },
      },
    });

    return templates.map(({ versions, ...t }) => {
      const latest = versions[0] ?? null;
      return {
        ...t,
        latestVersion: latest?.version ?? null,
        hasUnpublishedChanges: latest ? latest.publishedAt === null : false,
      };
    });
  }

  async create(workspaceId: string, userId: string, dto: CreateTemplateDto) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);
    const document = dto.document ?? createBlankDocument();
    await this.assertValid(workspaceId, document);

    const templateId = await this.prisma.$transaction(async (tx) => {
      const template = await tx.template.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          createdById: userId,
        },
      });
      await tx.templateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          document: document as Prisma.InputJsonValue,
          createdById: userId,
        },
      });
      return template.id;
    });
    return this.findOne(workspaceId, userId, templateId);
  }

  async findOne(workspaceId: string, userId: string, templateId: string) {
    await this.access.requireMember(workspaceId, userId);
    const template = await this.getTemplate(workspaceId, templateId);
    const versions = await this.prisma.templateVersion.findMany({
      where: { templateId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        publishedAt: true,
        createdAt: true,
      },
    });
    const latest = versions[0];
    const latestFull = latest
      ? await this.prisma.templateVersion.findUnique({
          where: { id: latest.id },
          select: { document: true },
        })
      : null;
    return {
      ...template,
      versions,
      latestVersionId: latest?.id ?? null,
      hasUnpublishedChanges: latest ? latest.publishedAt === null : false,
      document: latestFull?.document ?? null,
    };
  }

  async update(
    workspaceId: string,
    userId: string,
    templateId: string,
    dto: UpdateTemplateDto,
  ) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);
    const template = await this.getTemplate(workspaceId, templateId);

    const data: Prisma.TemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }
    if (dto.archived === true) data.status = TemplateStatus.ARCHIVED;
    if (dto.archived === false && template.status === TemplateStatus.ARCHIVED) {
      data.status = template.currentVersionId
        ? TemplateStatus.PUBLISHED
        : TemplateStatus.DRAFT;
    }

    await this.prisma.template.update({ where: { id: templateId }, data });
    return this.findOne(workspaceId, userId, templateId);
  }

  async saveDraft(
    workspaceId: string,
    userId: string,
    templateId: string,
    document: Record<string, unknown>,
  ) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);
    const template = await this.getTemplate(workspaceId, templateId);
    if (template.status === TemplateStatus.ARCHIVED) {
      throw new ConflictException('La plantilla está archivada');
    }
    await this.assertValid(workspaceId, document);

    const latest = await this.latestVersion(templateId);
    const json = document as Prisma.InputJsonValue;

    try {
      const saved =
        latest && latest.publishedAt === null
          ? await this.prisma.templateVersion.update({
              where: { id: latest.id },
              data: { document: json },
            })
          : await this.prisma.templateVersion.create({
              data: {
                templateId,
                version: (latest?.version ?? 0) + 1,
                document: json,
                createdById: userId,
              },
            });
      await this.prisma.template.update({
        where: { id: templateId },
        data: { updatedAt: new Date() },
      });
      return {
        versionId: saved.id,
        version: saved.version,
        savedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'La plantilla se modificó en paralelo. Recarga e inténtalo de nuevo',
        );
      }
      throw err;
    }
  }

  async publish(workspaceId: string, userId: string, templateId: string) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);
    const template = await this.getTemplate(workspaceId, templateId);
    if (template.status === TemplateStatus.ARCHIVED) {
      throw new ConflictException('La plantilla está archivada');
    }
    const latest = await this.latestVersion(templateId);
    if (!latest || latest.publishedAt !== null) {
      throw new BadRequestException('No hay cambios por publicar');
    }
    await this.assertValid(workspaceId, latest.document);

    await this.prisma.$transaction([
      this.prisma.templateVersion.update({
        where: { id: latest.id },
        data: { publishedAt: new Date() },
      }),
      this.prisma.template.update({
        where: { id: templateId },
        data: {
          status: TemplateStatus.PUBLISHED,
          currentVersionId: latest.id,
        },
      }),
    ]);
    return this.findOne(workspaceId, userId, templateId);
  }

  async duplicate(workspaceId: string, userId: string, templateId: string) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);
    const source = await this.getTemplate(workspaceId, templateId);
    const latest = await this.latestVersion(templateId);
    const document = (latest?.document ??
      createBlankDocument()) as Prisma.InputJsonValue;

    const copyId = await this.prisma.$transaction(async (tx) => {
      const copy = await tx.template.create({
        data: {
          workspaceId,
          name: `Copia de ${source.name}`.slice(0, 100),
          description: source.description,
          createdById: userId,
        },
      });
      await tx.templateVersion.create({
        data: {
          templateId: copy.id,
          version: 1,
          document,
          createdById: userId,
        },
      });
      return copy.id;
    });
    return this.findOne(workspaceId, userId, copyId);
  }

  async remove(workspaceId: string, userId: string, templateId: string) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);
    await this.getTemplate(workspaceId, templateId);
    try {
      await this.prisma.template.delete({ where: { id: templateId } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'La plantilla tiene piezas creadas. Archívala en lugar de eliminarla',
        );
      }
      throw err;
    }
    return { message: 'Plantilla eliminada' };
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private async getTemplate(workspaceId: string, templateId: string) {
    const template = await this.prisma.template.findFirst({
      where: { id: templateId, workspaceId },
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    return template;
  }

  private latestVersion(templateId: string) {
    return this.prisma.templateVersion.findFirst({
      where: { templateId },
      orderBy: { version: 'desc' },
    });
  }

  private async assertValid(workspaceId: string, document: unknown) {
    const ctx = await this.buildContext(workspaceId, document);
    const errors = validateTemplateDocument(document, ctx);
    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'El documento de la plantilla no es válido',
        errors,
      });
    }
  }

  private async buildContext(
    workspaceId: string,
    document: unknown,
  ): Promise<DocumentContext> {
    const brand = await this.prisma.brandKit.findUnique({
      where: { workspaceId },
    });
    const ids = (value: unknown): string[] =>
      Array.isArray(value)
        ? (value as BrandRef[])
            .map((v) => v?.id)
            .filter((id): id is string => typeof id === 'string')
        : [];

    const referenced = collectAssetIds(document);
    const assets =
      referenced.length > 0
        ? await this.prisma.asset.findMany({
            where: { workspaceId, id: { in: referenced } },
            select: { id: true },
          })
        : [];

    return {
      brandColorIds: new Set(ids(brand?.colors)),
      brandFontIds: new Set(ids(brand?.fonts)),
      assetIds: new Set(assets.map((a) => a.id)),
    };
  }
}
