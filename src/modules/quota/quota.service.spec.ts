import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { QuotaExceededException, QuotaService } from './quota.service';

describe('QuotaService', () => {
  const prisma = {
    asset: { aggregate: jest.fn() },
    piece: { count: jest.fn() },
    renderJob: { count: jest.fn() },
    review: { count: jest.fn() },
  };
  const values: Record<string, number> = {
    QUOTA_STORAGE_MB: 1,
    QUOTA_ACTIVE_PIECES: 2,
    QUOTA_RENDERS_PER_MONTH: 3,
    REVIEW_MONTHLY_QUOTA: 4,
  };
  const config = {
    get: jest.fn((key: string, fallback: number) => values[key] ?? fallback),
  };
  let service: QuotaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QuotaService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('reports usage against the configured limits', async () => {
    prisma.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 1000 } });
    prisma.piece.count.mockResolvedValue(1);
    prisma.renderJob.count.mockResolvedValue(2);
    prisma.review.count.mockResolvedValue(3);

    const usage = await service.usage('w1');

    expect(usage.storageBytes).toEqual({ used: 1000, limit: 1024 * 1024 });
    expect(usage.activePieces).toEqual({ used: 1, limit: 2 });
    expect(usage.rendersPerMonth).toEqual({ used: 2, limit: 3 });
    expect(usage.reviewsPerMonth).toEqual({ used: 3, limit: 4 });
  });

  it('rejects an upload that would exceed the storage quota with 402', async () => {
    prisma.asset.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 1024 * 1024 - 10 },
    });
    const err = await service.assertStorage('w1', 11).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededException);
    expect((err as QuotaExceededException).getStatus()).toBe(402);
    expect((err as QuotaExceededException).getResponse()).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      resource: 'storage',
    });
  });

  it('allows an upload that exactly fills the storage quota', async () => {
    prisma.asset.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 1024 * 1024 - 10 },
    });
    await expect(service.assertStorage('w1', 10)).resolves.toBeUndefined();
  });

  it('rejects creating a piece at the active pieces limit', async () => {
    prisma.piece.count.mockResolvedValue(2);
    await expect(service.assertActivePieces('w1')).rejects.toBeInstanceOf(
      QuotaExceededException,
    );
  });

  it('allows creating a piece below the limit', async () => {
    prisma.piece.count.mockResolvedValue(1);
    await expect(service.assertActivePieces('w1')).resolves.toBeUndefined();
  });

  it('rejects an export at the monthly render limit', async () => {
    prisma.renderJob.count.mockResolvedValue(3);
    await expect(service.assertMonthlyRenders('w1')).rejects.toMatchObject({
      resource: 'rendersPerMonth',
    });
  });

  it('treats a workspace without assets as zero usage', async () => {
    prisma.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: null } });
    await expect(service.assertStorage('w1', 1)).resolves.toBeUndefined();
  });
});
