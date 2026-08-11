import { BadRequestException, Injectable } from '@nestjs/common';
import { AssetKind, WorkspaceRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async get(workspaceId: string, userId: string) {
    await this.access.requireMember(workspaceId, userId);
    const kit = await this.prisma.brandKit.findUnique({
      where: { workspaceId },
    });
    return this.present(workspaceId, kit);
  }

  async update(workspaceId: string, userId: string, dto: UpdateBrandDto) {
    await this.access.requireRole(workspaceId, userId, [WorkspaceRole.ADMIN]);

    const colors = dto.colors.map((c) => ({ ...c, id: c.id ?? randomUUID() }));
    const fonts = dto.fonts.map((f) => ({ ...f, id: f.id ?? randomUUID() }));

    this.assertUnique(
      colors.map((c) => c.id),
      'colores',
    );
    this.assertUnique(
      fonts.map((f) => f.id),
      'fuentes',
    );

    const logoAssetId = dto.logoAssetId ?? null;
    const assetChecks: Array<{ id: string; kinds: AssetKind[]; what: string }> =
      [];
    if (logoAssetId) {
      assetChecks.push({
        id: logoAssetId,
        kinds: [AssetKind.LOGO, AssetKind.IMAGE],
        what: 'El logo',
      });
    }
    for (const f of fonts) {
      if (f.assetId) {
        assetChecks.push({
          id: f.assetId,
          kinds: [AssetKind.FONT],
          what: `La fuente "${f.family}"`,
        });
      }
    }
    if (assetChecks.length > 0) {
      const found = await this.prisma.asset.findMany({
        where: { workspaceId, id: { in: assetChecks.map((a) => a.id) } },
        select: { id: true, kind: true },
      });
      const byId = new Map(found.map((a) => [a.id, a.kind]));
      for (const check of assetChecks) {
        const kind = byId.get(check.id);
        if (!kind || !check.kinds.includes(kind)) {
          throw new BadRequestException(
            `${check.what} debe referenciar un asset válido de este espacio`,
          );
        }
      }
    }

    const kit = await this.prisma.brandKit.upsert({
      where: { workspaceId },
      create: { workspaceId, colors, fonts, logoAssetId },
      update: { colors, fonts, logoAssetId },
    });
    return this.present(workspaceId, kit);
  }

  private assertUnique(ids: string[], what: string) {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(`Hay identificadores de ${what} repetidos`);
    }
  }

  private async present(
    workspaceId: string,
    kit: {
      colors: unknown;
      fonts: unknown;
      logoAssetId: string | null;
      updatedAt: Date;
    } | null,
  ) {
    let logoUrl: string | null = null;
    if (kit?.logoAssetId) {
      const logo = await this.prisma.asset.findFirst({
        where: { id: kit.logoAssetId, workspaceId },
      });
      if (logo) logoUrl = await this.storage.getPresignedUrl(logo.objectKey);
    }
    return {
      colors: kit?.colors ?? [],
      fonts: kit?.fonts ?? [],
      logoAssetId: kit?.logoAssetId ?? null,
      logoUrl,
      updatedAt: kit?.updatedAt ?? null,
    };
  }
}
