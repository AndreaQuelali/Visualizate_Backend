import { BadRequestException, ConflictException } from '@nestjs/common';
import { PieceService } from './piece.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { StorageService } from '../../infrastructure/storage/storage.service';

const docV1 = {
  fields: [{ key: 'titulo', label: 'Título', type: 'text', required: true }],
};
const docV2 = {
  fields: [
    { key: 'titulo', label: 'Título', type: 'text', required: true },
    { key: 'sub', label: 'Sub', type: 'text', required: true },
  ],
};

describe('PieceService', () => {
  const prisma = {
    template: { findFirst: jest.fn(), findUnique: jest.fn() },
    templateVersion: { findUnique: jest.fn() },
    renderJob: { findMany: jest.fn().mockResolvedValue([]) },
    piece: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    asset: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const storage = { removeObject: jest.fn().mockResolvedValue(undefined) };
  const quota = { assertActivePieces: jest.fn().mockResolvedValue(undefined) };
  let service: PieceService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.piece.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'p1', ...data }),
    );
    service = new PieceService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      quota as unknown as QuotaService,
    );
  });

  it('refuses to create a piece from an unpublished template', async () => {
    prisma.template.findFirst.mockResolvedValue({
      id: 't1',
      status: 'DRAFT',
      currentVersionId: null,
    });
    await expect(
      service.create('w1', 'u1', { templateId: 't1', title: 'X' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pins a new piece to the published version with initial data', async () => {
    prisma.template.findFirst.mockResolvedValue({
      id: 't1',
      status: 'PUBLISHED',
      currentVersionId: 'v1',
    });
    prisma.templateVersion.findUnique.mockResolvedValue({
      id: 'v1',
      document: docV1,
    });
    prisma.piece.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve(data),
    );

    const res = (await service.create('w1', 'u1', {
      templateId: 't1',
      title: ' Flyer ',
    })) as unknown as {
      templateVersionId: string;
      title: string;
      data: object;
    };

    expect(res.templateVersionId).toBe('v1');
    expect(res.title).toBe('Flyer');
    expect(res.data).toEqual({ titulo: '' });
  });

  it('blocks READY while required fields are empty, with per-field errors', async () => {
    prisma.piece.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'DRAFT',
      templateVersionId: 'v1',
      data: { titulo: '' },
    });
    prisma.templateVersion.findUnique.mockResolvedValue({ document: docV1 });

    const err: unknown = await service
      .update('w1', 'u1', 'p1', { status: 'READY' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as {
      errors: Array<{ field: string }>;
    };
    expect(body.errors[0].field).toBe('titulo');
    expect(prisma.piece.update).not.toHaveBeenCalled();
  });

  it('saves a draft with an empty required field', async () => {
    prisma.piece.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'DRAFT',
      templateVersionId: 'v1',
      data: { titulo: '' },
    });
    prisma.templateVersion.findUnique.mockResolvedValue({ document: docV1 });
    await service.update('w1', 'u1', 'p1', { data: { titulo: '' } });
    expect(prisma.piece.update).toHaveBeenCalled();
  });

  it('refuses to edit data of an archived piece', async () => {
    prisma.piece.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'ARCHIVED',
      templateVersionId: 'v1',
      data: {},
    });
    await expect(
      service.update('w1', 'u1', 'p1', { data: { titulo: 'x' } }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('upgrade keeps data, adds new fields and reverts READY to DRAFT when invalid', async () => {
    prisma.piece.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'READY',
      templateId: 't1',
      templateVersionId: 'v1',
      data: { titulo: 'Hola' },
    });
    prisma.template.findUnique.mockResolvedValue({ currentVersionId: 'v2' });
    prisma.templateVersion.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ document: where.id === 'v1' ? docV1 : docV2 }),
    );

    const res = await service.upgrade('w1', 'u1', 'p1');

    const call = prisma.piece.update.mock.calls[0] as [
      { data: { templateVersionId: string; data: object; status: string } },
    ];
    expect(call[0].data.templateVersionId).toBe('v2');
    expect(call[0].data.data).toEqual({ titulo: 'Hola', sub: '' });
    expect(call[0].data.status).toBe('DRAFT');
    expect(res.revertedToDraft).toBe(true);
  });

  it('upgrade fails when the piece already uses the latest version', async () => {
    prisma.piece.findFirst.mockResolvedValue({
      id: 'p1',
      status: 'DRAFT',
      templateId: 't1',
      templateVersionId: 'v2',
      data: {},
    });
    prisma.template.findUnique.mockResolvedValue({ currentVersionId: 'v2' });
    await expect(service.upgrade('w1', 'u1', 'p1')).rejects.toThrow(
      'ya usa la última versión',
    );
  });
});
