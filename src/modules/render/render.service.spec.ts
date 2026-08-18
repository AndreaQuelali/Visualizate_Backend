import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { RenderFormat, RenderStatus } from '@prisma/client';
import {
  RenderLimitException,
  RenderService,
  stableHash,
} from './render.service';
import { RenderError } from './render.constants';
import { createBlankDocument } from '../template/template-document';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { PlaywrightService } from './playwright.service';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

const doc = () => ({
  ...createBlankDocument(),
  fields: [{ key: 't', label: 'T', type: 'text', required: true }],
});

describe('RenderService', () => {
  const prisma = {
    piece: { findFirst: jest.fn() },
    renderJob: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    brandKit: { findUnique: jest.fn() },
    asset: { findMany: jest.fn() },
    templateVersion: { findUnique: jest.fn() },
  };
  const storage = {
    putObject: jest.fn(),
    removeObject: jest.fn(),
    getPresignedUrl: jest.fn(),
    getOrigin: jest.fn().mockReturnValue('http://minio:9000'),
  };
  const access = {
    requireMember: jest.fn(),
  };
  const playwright = { capture: jest.fn() };
  const config = {
    get: jest.fn((_k: string, d: unknown) => d),
  };
  const queue = { add: jest.fn(), getJob: jest.fn() };
  let service: RenderService;

  const readyPiece = (overrides: object = {}) => ({
    id: 'p1',
    status: 'READY',
    templateVersionId: 'v1',
    data: { t: 'Hola' },
    templateVersion: { document: doc() },
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    access.requireMember.mockResolvedValue({ role: 'ORGANIZER' });
    config.get.mockImplementation((_k: string, d: unknown) => d);
    storage.getOrigin.mockReturnValue('http://minio:9000');
    storage.removeObject.mockResolvedValue(undefined);
    storage.putObject.mockResolvedValue(undefined);
    prisma.brandKit.findUnique.mockResolvedValue(null);
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.renderJob.findFirst.mockResolvedValue(null);
    prisma.renderJob.count.mockResolvedValue(0);
    prisma.renderJob.findMany.mockResolvedValue([]);
    prisma.renderJob.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'j1', status: 'QUEUED', ...data }),
    );
    queue.add.mockResolvedValue({});
    service = new RenderService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      access as unknown as WorkspaceAccessService,
      playwright as unknown as PlaywrightService,
      config as unknown as ConfigService,
      queue as unknown as Queue,
    );
  });

  describe('request', () => {
    it('rejects pieces that are not READY', async () => {
      prisma.piece.findFirst.mockResolvedValue(readyPiece({ status: 'DRAFT' }));
      await expect(
        service.request('w1', 'u1', 'p1', { format: RenderFormat.PNG }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an output that would be too large', async () => {
      const big = doc();
      big.canvas.width = 4096;
      big.canvas.height = 4096;
      prisma.piece.findFirst.mockResolvedValue(
        readyPiece({ templateVersion: { document: big } }),
      );
      await expect(
        service.request('w1', 'u1', 'p1', {
          format: RenderFormat.PNG,
          scale: 3,
        }),
      ).rejects.toThrow('demasiado grande');
    });

    it('enqueues a job with retries/backoff; PDF ignores scale', async () => {
      prisma.piece.findFirst.mockResolvedValue(readyPiece());
      const res = await service.request('w1', 'u1', 'p1', {
        format: RenderFormat.PDF,
        scale: 3,
      });
      expect(res.reused).toBe(false);
      const create = prisma.renderJob.create.mock.calls[0] as [
        { data: { scale: number; templateVersionId: string } },
      ];
      expect(create[0].data.scale).toBe(1);
      expect(create[0].data.templateVersionId).toBe('v1');
      const add = queue.add.mock.calls[0] as [
        string,
        { jobId: string },
        { attempts: number; backoff: { type: string } },
      ];
      expect(add[1]).toEqual({ jobId: 'j1' });
      expect(add[2].attempts).toBe(3);
      expect(add[2].backoff.type).toBe('exponential');
    });

    it('returns the existing identical job without rendering again', async () => {
      prisma.piece.findFirst.mockResolvedValue(readyPiece());
      prisma.renderJob.findFirst.mockResolvedValue({
        id: 'old',
        status: 'SUCCEEDED',
        outputObjectKey: 'k',
      });
      const res = await service.request('w1', 'u1', 'p1', {
        format: RenderFormat.PNG,
      });
      expect(res.reused).toBe(true);
      expect(res.job.id).toBe('old');
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.renderJob.create).not.toHaveBeenCalled();
    });

    it('returns 429 with Retry-After when too many jobs are active', async () => {
      prisma.piece.findFirst.mockResolvedValue(readyPiece());
      prisma.renderJob.count.mockResolvedValue(3);
      const err: unknown = await service
        .request('w1', 'u1', 'p1', { format: RenderFormat.PNG })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderLimitException);
      expect((err as RenderLimitException).retryAfterSeconds).toBeGreaterThan(
        0,
      );
    });

    it('returns 429 after the hourly quota is used', async () => {
      prisma.piece.findFirst.mockResolvedValue(readyPiece());
      prisma.renderJob.findMany.mockResolvedValue(
        Array.from({ length: 20 }, () => ({ createdAt: new Date() })),
      );
      await expect(
        service.request('w1', 'u1', 'p1', { format: RenderFormat.PNG }),
      ).rejects.toBeInstanceOf(RenderLimitException);
    });

    it('marks the job FAILED and answers 503 when the queue is down', async () => {
      prisma.piece.findFirst.mockResolvedValue(readyPiece());
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(
        service.request('w1', 'u1', 'p1', { format: RenderFormat.PNG }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      const upd = prisma.renderJob.update.mock.calls[0] as [
        { data: { status: string; errorCode: string } },
      ];
      expect(upd[0].data).toMatchObject({
        status: 'FAILED',
        errorCode: 'QUEUE_UNAVAILABLE',
      });
    });
  });

  describe('execute', () => {
    const queued = (attempts = 0) => ({
      id: 'j1',
      workspaceId: 'w1',
      pieceId: 'p1',
      format: RenderFormat.PNG,
      scale: 2,
      status: RenderStatus.QUEUED,
      attempts,
      templateVersionId: 'v1',
      inputData: { t: 'Hola' },
    });

    beforeEach(() => {
      prisma.templateVersion.findUnique.mockResolvedValue({ document: doc() });
      prisma.renderJob.updateMany.mockResolvedValue({ count: 1 });
    });

    const lastUpdate = (): { data: Record<string, unknown> } => {
      const calls = prisma.renderJob.updateMany.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      return calls[calls.length - 1][0];
    };

    it('renders, stores the file and marks SUCCEEDED', async () => {
      prisma.renderJob.findUnique.mockResolvedValue(queued());
      playwright.capture.mockResolvedValue(Buffer.from('png-bytes'));

      await service.execute('j1');

      const cap = playwright.capture.mock.calls[0] as [
        {
          format: string;
          scale: number;
          width: number;
          allowedOrigins: string[];
        },
      ];
      expect(cap[0]).toMatchObject({
        format: 'PNG',
        scale: 2,
        width: 1080,
        allowedOrigins: ['http://minio:9000'],
      });
      expect(storage.putObject).toHaveBeenCalledWith(
        'workspaces/w1/renders/j1.png',
        expect.any(Buffer),
        'image/png',
      );
      expect(lastUpdate().data).toMatchObject({
        status: 'SUCCEEDED',
        outputObjectKey: 'workspaces/w1/renders/j1.png',
      });
    });

    it('does nothing when the job is no longer QUEUED (e.g. cancelled)', async () => {
      prisma.renderJob.findUnique.mockResolvedValue({
        ...queued(),
        status: RenderStatus.CANCELLED,
      });
      await service.execute('j1');
      expect(playwright.capture).not.toHaveBeenCalled();
    });

    it('discards the output if the job was cancelled while rendering', async () => {
      prisma.renderJob.findUnique.mockResolvedValue(queued());
      playwright.capture.mockResolvedValue(Buffer.from('x'));
      prisma.renderJob.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim
        .mockResolvedValueOnce({ count: 0 }); // finish: no longer RUNNING
      await service.execute('j1');
      expect(storage.removeObject).toHaveBeenCalledWith(
        'workspaces/w1/renders/j1.png',
      );
    });

    it('requeues and rethrows transient errors while attempts remain', async () => {
      prisma.renderJob.findUnique.mockResolvedValue(queued(0));
      const boom = new RenderError('RENDER_TIMEOUT', 'lento', true);
      playwright.capture.mockRejectedValue(boom);

      await expect(service.execute('j1')).rejects.toBe(boom);
      expect(lastUpdate().data).toMatchObject({
        status: 'QUEUED',
        errorCode: 'RENDER_TIMEOUT',
      });
    });

    it('fails for good when the last attempt fails', async () => {
      prisma.renderJob.findUnique.mockResolvedValue(queued(2));
      playwright.capture.mockRejectedValue(
        new RenderError('RENDER_TIMEOUT', 'lento', true),
      );
      await expect(service.execute('j1')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(lastUpdate().data).toMatchObject({
        status: 'FAILED',
        errorCode: 'RENDER_TIMEOUT',
      });
    });

    it('does not retry permanent errors such as a broken image', async () => {
      prisma.renderJob.findUnique.mockResolvedValue(queued(0));
      playwright.capture.mockRejectedValue(
        new RenderError('ASSET_LOAD_FAILED', 'imagen rota'),
      );
      await expect(service.execute('j1')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(lastUpdate().data).toMatchObject({
        status: 'FAILED',
        errorCode: 'ASSET_LOAD_FAILED',
      });
      expect(storage.putObject).not.toHaveBeenCalled();
    });
  });

  describe('cancel / download / cleanup', () => {
    const job = (extra: object = {}) => ({
      id: 'j1',
      workspaceId: 'w1',
      requestedById: 'u1',
      status: 'QUEUED',
      ...extra,
    });

    it('cancels an active job and removes it from the queue', async () => {
      prisma.renderJob.findFirst.mockResolvedValue(job());
      prisma.renderJob.updateMany.mockResolvedValue({ count: 1 });
      const remove = jest.fn().mockResolvedValue(undefined);
      queue.getJob.mockResolvedValue({ remove });
      await service.cancel('w1', 'u1', 'j1');
      expect(remove).toHaveBeenCalled();
    });

    it('refuses to cancel a finished job (409)', async () => {
      prisma.renderJob.findFirst.mockResolvedValue(
        job({ status: 'SUCCEEDED' }),
      );
      prisma.renderJob.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.cancel('w1', 'u1', 'j1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('only the requester or an ADMIN can cancel', async () => {
      prisma.renderJob.findFirst.mockResolvedValue(
        job({ requestedById: 'other' }),
      );
      await expect(service.cancel('w1', 'u1', 'j1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      access.requireMember.mockResolvedValue({ role: 'ADMIN' });
      prisma.renderJob.updateMany.mockResolvedValue({ count: 1 });
      queue.getJob.mockResolvedValue(null);
      await expect(service.cancel('w1', 'u1', 'j1')).resolves.toBeDefined();
    });

    it('download is unavailable until SUCCEEDED and sanitizes the filename', async () => {
      prisma.renderJob.findFirst.mockResolvedValueOnce({
        ...job(),
        piece: { title: 'x' },
      });
      await expect(service.download('w1', 'u1', 'j1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      prisma.renderJob.findFirst.mockResolvedValueOnce({
        ...job({ status: 'SUCCEEDED', format: 'PNG', outputObjectKey: 'k' }),
        piece: { title: 'Flyer: "Mayo" / 12?' },
      });
      storage.getPresignedUrl.mockResolvedValue('https://signed');
      const res = await service.download('w1', 'u1', 'j1');
      expect(res).toMatchObject({
        url: 'https://signed',
        filename: 'Flyer Mayo  12.png',
        expiresInSeconds: 300,
      });
    });

    it('cleanup removes expired files and rows', async () => {
      prisma.renderJob.findMany.mockResolvedValue([
        { id: 'a', outputObjectKey: 'k1' },
        { id: 'b', outputObjectKey: null },
      ]);
      prisma.renderJob.deleteMany.mockResolvedValue({ count: 2 });
      await expect(service.cleanupExpired()).resolves.toBe(2);
      expect(storage.removeObject).toHaveBeenCalledTimes(1);
      expect(prisma.renderJob.deleteMany).toHaveBeenCalled();
    });
  });
});

describe('stableHash', () => {
  const base = {
    pieceId: 'p',
    templateVersionId: 'v',
    format: RenderFormat.PNG,
    scale: 1,
    data: { b: '2', a: '1' },
    brandUpdatedAt: null,
  };

  it('is independent of key order and sensitive to every input', () => {
    const h = stableHash(base);
    expect(stableHash({ ...base, data: { a: '1', b: '2' } })).toBe(h);
    expect(stableHash({ ...base, data: { a: '1', b: '3' } })).not.toBe(h);
    expect(stableHash({ ...base, scale: 2 })).not.toBe(h);
    expect(stableHash({ ...base, format: RenderFormat.PDF })).not.toBe(h);
    expect(stableHash({ ...base, brandUpdatedAt: new Date() })).not.toBe(h);
  });
});
