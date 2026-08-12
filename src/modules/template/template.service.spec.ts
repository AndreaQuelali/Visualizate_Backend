import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { TemplateService } from './template.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { createBlankDocument } from './template-document';

describe('TemplateService', () => {
  const prisma = {
    template: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    templateVersion: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    brandKit: { findUnique: jest.fn().mockResolvedValue(null) },
    asset: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  const member = { role: WorkspaceRole.DESIGNER };
  const access = {
    requireMember: jest.fn().mockResolvedValue(member),
    requireRole: jest.fn().mockResolvedValue(member),
  };
  let service: TemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.brandKit.findUnique.mockResolvedValue(null);
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.template.findFirst.mockResolvedValue({
      id: 't1',
      workspaceId: 'w1',
      name: 'T',
      status: 'DRAFT',
    });
    service = new TemplateService(
      prisma as unknown as PrismaService,
      access as unknown as WorkspaceAccessService,
    );
  });

  it('updates the open draft in place instead of creating a version', async () => {
    prisma.templateVersion.findFirst.mockResolvedValue({
      id: 'v1',
      version: 1,
      publishedAt: null,
    });
    prisma.templateVersion.update.mockResolvedValue({ id: 'v1', version: 1 });

    const res = await service.saveDraft(
      'w1',
      'u1',
      't1',
      createBlankDocument() as unknown as Record<string, unknown>,
    );

    expect(prisma.templateVersion.update).toHaveBeenCalled();
    expect(prisma.templateVersion.create).not.toHaveBeenCalled();
    expect(res.version).toBe(1);
  });

  it('creates version N+1 when the latest version is already published', async () => {
    prisma.templateVersion.findFirst.mockResolvedValue({
      id: 'v1',
      version: 1,
      publishedAt: new Date(),
    });
    prisma.templateVersion.create.mockResolvedValue({ id: 'v2', version: 2 });

    const res = await service.saveDraft(
      'w1',
      'u1',
      't1',
      createBlankDocument() as unknown as Record<string, unknown>,
    );

    const call = prisma.templateVersion.create.mock.calls[0] as [
      { data: { version: number } },
    ];
    expect(call[0].data.version).toBe(2);
    expect(prisma.templateVersion.update).not.toHaveBeenCalled();
    expect(res.version).toBe(2);
  });

  it('rejects an invalid document with 400 and the error list', async () => {
    await expect(
      service.saveDraft('w1', 'u1', 't1', { schemaVersion: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to publish when there is nothing to publish', async () => {
    prisma.templateVersion.findFirst.mockResolvedValue({
      id: 'v1',
      version: 1,
      publishedAt: new Date(),
      document: createBlankDocument(),
    });
    await expect(service.publish('w1', 'u1', 't1')).rejects.toThrow(
      'No hay cambios por publicar',
    );
  });

  it('propagates the role check failure for write operations', async () => {
    access.requireRole.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.create('w1', 'u1', { name: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
