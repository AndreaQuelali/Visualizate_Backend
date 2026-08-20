import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { QuotaService } from '../quota/quota.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const prisma = {
    brandKit: { findUnique: jest.fn() },
    template: { count: jest.fn(), findMany: jest.fn() },
    piece: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    renderJob: { findMany: jest.fn() },
    review: { findMany: jest.fn() },
  };
  const storage = { getPresignedUrl: jest.fn() };
  const quota = { usage: jest.fn() };
  let service: DashboardService;

  const emptyUsage = {
    period: { start: 's', end: 'e' },
    storageBytes: { used: 0, limit: 10 },
    activePieces: { used: 0, limit: 10 },
    rendersPerMonth: { used: 0, limit: 10 },
    reviewsPerMonth: { used: 0, limit: 10 },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.brandKit.findUnique.mockResolvedValue(null);
    prisma.template.count.mockResolvedValue(0);
    prisma.piece.count.mockResolvedValue(0);
    prisma.piece.findMany.mockResolvedValue([]);
    prisma.piece.groupBy.mockResolvedValue([]);
    prisma.renderJob.findMany.mockResolvedValue([]);
    prisma.review.findMany.mockResolvedValue([]);
    quota.usage.mockResolvedValue(emptyUsage);
    service = new DashboardService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      quota as unknown as QuotaService,
    );
  });

  it('returns empty blocks and no onboarding progress for a new workspace', async () => {
    const dash = await service.get('w1');
    expect(dash.onboarding).toEqual({
      brand: false,
      template: false,
      piece: false,
    });
    expect(dash.recentPieces).toEqual([]);
    expect(dash.topTemplates).toEqual([]);
    expect(dash.recentRenders).toEqual([]);
    expect(dash.pendingReviews).toEqual([]);
  });

  it('marks onboarding steps as done when the data exists', async () => {
    prisma.brandKit.findUnique.mockResolvedValue({ id: 'b1' });
    prisma.template.count.mockResolvedValue(2);
    prisma.piece.count.mockResolvedValue(5);
    const dash = await service.get('w1');
    expect(dash.onboarding).toEqual({
      brand: true,
      template: true,
      piece: true,
    });
  });

  it('adds a thumbnail from the latest PNG render of each recent piece', async () => {
    prisma.piece.findMany.mockResolvedValue([
      {
        id: 'p1',
        title: 'Con render',
        status: 'READY',
        updatedAt: new Date(),
        template: { name: 'Flyer' },
      },
      {
        id: 'p2',
        title: 'Sin render',
        status: 'DRAFT',
        updatedAt: new Date(),
        template: { name: 'Flyer' },
      },
    ]);
    prisma.renderJob.findMany.mockResolvedValue([
      { pieceId: 'p1', outputObjectKey: 'new.png' },
      { pieceId: 'p1', outputObjectKey: 'old.png' },
    ]);
    storage.getPresignedUrl.mockResolvedValue('https://signed/new.png');

    const dash = await service.get('w1');
    const pieces = dash.recentPieces as {
      id: string;
      templateName: string;
      thumbnailUrl: string | null;
    }[];

    expect(storage.getPresignedUrl).toHaveBeenCalledTimes(1);
    expect(storage.getPresignedUrl).toHaveBeenCalledWith('new.png', 300);
    expect(pieces[0]).toMatchObject({
      id: 'p1',
      templateName: 'Flyer',
      thumbnailUrl: 'https://signed/new.png',
    });
    expect(pieces[1].thumbnailUrl).toBeNull();
  });

  it('keeps a piece without thumbnail when signing the URL fails', async () => {
    prisma.piece.findMany.mockResolvedValue([
      {
        id: 'p1',
        title: 'X',
        status: 'READY',
        updatedAt: new Date(),
        template: { name: 'T' },
      },
    ]);
    prisma.renderJob.findMany.mockResolvedValue([
      { pieceId: 'p1', outputObjectKey: 'k.png' },
    ]);
    storage.getPresignedUrl.mockRejectedValue(new Error('minio down'));
    const dash = await service.get('w1');
    expect(
      (dash.recentPieces as { thumbnailUrl: null }[])[0].thumbnailUrl,
    ).toBe(null);
  });

  it('ranks the most used templates and drops ones that no longer exist', async () => {
    prisma.piece.groupBy.mockResolvedValue([
      { templateId: 't1', _count: { _all: 7 } },
      { templateId: 'gone', _count: { _all: 2 } },
    ]);
    prisma.template.findMany.mockResolvedValue([{ id: 't1', name: 'Flyer' }]);
    const dash = await service.get('w1');
    expect(dash.topTemplates).toEqual([
      { id: 't1', name: 'Flyer', piecesCount: 7 },
    ]);
  });

  it('flattens the piece title into recent renders', async () => {
    prisma.renderJob.findMany.mockResolvedValue([
      {
        id: 'j1',
        pieceId: 'p1',
        format: 'PNG',
        status: 'FAILED',
        errorMessage: 'boom',
        createdAt: new Date(),
        finishedAt: null,
        piece: { title: 'Mi pieza' },
      },
    ]);
    const dash = await service.get('w1');
    expect(dash.recentRenders).toMatchObject([
      { id: 'j1', pieceTitle: 'Mi pieza', status: 'FAILED' },
    ]);
    expect(
      (dash.recentRenders as object[])[0] as Record<string, unknown>,
    ).not.toHaveProperty('piece');
  });

  it('lists only the latest review per piece and skips archived pieces', async () => {
    const review = (
      id: string,
      pieceId: string,
      pending: number,
      status = 'READY',
    ) => ({
      id,
      pieceId,
      createdAt: new Date(),
      piece: { title: `T-${pieceId}`, status },
      _count: { items: pending },
    });
    prisma.review.findMany.mockResolvedValue([
      review('r3', 'p1', 2),
      review('r2', 'p1', 5),
      review('r1', 'p2', 1, 'ARCHIVED'),
      review('r0', 'p3', 4),
    ]);
    const dash = await service.get('w1');
    expect(dash.pendingReviews).toMatchObject([
      { reviewId: 'r3', pieceId: 'p1', pendingItems: 2 },
      { reviewId: 'r0', pieceId: 'p3', pendingItems: 4 },
    ]);
  });

  it('reports a failing block without breaking the rest', async () => {
    prisma.renderJob.findMany.mockRejectedValue(new Error('db timeout'));
    const dash = await service.get('w1');
    expect(dash.recentRenders).toEqual({
      error: 'No se pudo cargar este bloque',
    });
    expect(dash.onboarding).toHaveProperty('brand');
    expect(dash.usage).toHaveProperty('storageBytes');
  });

  it('includes the pieces created this month in the usage block', async () => {
    prisma.piece.count.mockResolvedValue(4);
    const dash = await service.get('w1');
    expect(dash.usage).toMatchObject({ piecesCreatedThisMonth: 4 });
  });
});
