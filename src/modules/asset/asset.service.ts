import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Asset, AssetKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { detectFileType, isUnsafeSvg } from '../../common/file-type';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import {
  EDITOR_ROLES,
  WorkspaceAccessService,
} from '../workspace/workspace-access.service';
import { collectAssetIds } from '../template/template-document';

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export interface AssetUpload {
  buffer: Buffer;
  originalname: string;
  size: number;
}

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async upload(
    workspaceId: string,
    userId: string,
    file: AssetUpload,
    opts: { kind?: AssetKind; name?: string },
  ) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);

    if (file.size > MAX_ASSET_BYTES) {
      throw new BadRequestException(
        'El archivo supera el tamaño máximo de 10 MB',
      );
    }

    const detected = detectFileType(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Tipo de archivo no permitido. Usa PNG, JPG, WebP, SVG, WOFF2 o TTF',
      );
    }

    if (detected.mime === 'image/svg+xml') {
      if (isUnsafeSvg(file.buffer.toString('utf8'))) {
        throw new BadRequestException(
          'El SVG contiene contenido activo (scripts o eventos) y no se permite',
        );
      }
    }

    let kind: AssetKind;
    if (detected.family === 'font') {
      if (opts.kind && opts.kind !== AssetKind.FONT) {
        throw new BadRequestException('Una fuente debe tener el tipo FONT');
      }
      kind = AssetKind.FONT;
    } else {
      if (opts.kind === AssetKind.FONT) {
        throw new BadRequestException('El archivo no es una fuente válida');
      }
      kind = opts.kind ?? AssetKind.IMAGE;
    }

    let width: number | null = null;
    let height: number | null = null;
    if (detected.family === 'image') {
      try {
        const meta = await sharp(file.buffer).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch {
        throw new BadRequestException('La imagen está dañada o no es válida');
      }
    }

    const objectKey = `workspaces/${workspaceId}/assets/${randomUUID()}.${detected.ext}`;
    await this.storage.putObject(objectKey, file.buffer, detected.mime);

    try {
      const asset = await this.prisma.asset.create({
        data: {
          workspaceId,
          kind,
          name: (opts.name?.trim() || file.originalname).slice(0, 120),
          objectKey,
          mimeType: detected.mime,
          sizeBytes: file.size,
          width,
          height,
          createdById: userId,
        },
      });
      return this.withUrl(asset);
    } catch (err) {
      await this.storage.removeObject(objectKey).catch(() => undefined);
      throw err;
    }
  }

  async list(workspaceId: string, userId: string, kind?: AssetKind) {
    await this.access.requireMember(workspaceId, userId);
    const assets = await this.prisma.asset.findMany({
      where: { workspaceId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(assets.map((a) => this.withUrl(a)));
  }

  async remove(workspaceId: string, userId: string, assetId: string) {
    await this.access.requireRole(workspaceId, userId, EDITOR_ROLES);
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, workspaceId },
    });
    if (!asset) throw new NotFoundException('Asset no encontrado');

    const usedIn = await this.findUsages(workspaceId, assetId);
    if (usedIn.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        message: `El asset está en uso en: ${usedIn.join(', ')}`,
        usedIn,
      });
    }

    await this.prisma.asset.delete({ where: { id: assetId } });
    await this.storage.removeObject(asset.objectKey).catch((err: unknown) => {
      this.logger.warn(
        `No se pudo borrar el objeto ${asset.objectKey}: ${String(err)}`,
      );
    });
    return { message: 'Asset eliminado' };
  }

  private async findUsages(
    workspaceId: string,
    assetId: string,
  ): Promise<string[]> {
    const usedIn: string[] = [];

    const brand = await this.prisma.brandKit.findUnique({
      where: { workspaceId },
    });
    if (brand) {
      const inFonts = JSON.stringify(brand.fonts).includes(assetId);
      if (brand.logoAssetId === assetId || inFonts) usedIn.push('Marca');
    }

    const versions = await this.prisma.templateVersion.findMany({
      where: { template: { workspaceId } },
      select: { document: true, template: { select: { name: true } } },
    });
    const templates = new Set<string>();
    for (const v of versions) {
      if (collectAssetIds(v.document).includes(assetId)) {
        templates.add(`Plantilla "${v.template.name}"`);
      }
    }
    return [...usedIn, ...templates];
  }

  private async withUrl(asset: Asset) {
    const url = await this.storage.getPresignedUrl(asset.objectKey, 3600);
    return { ...asset, url };
  }
}
