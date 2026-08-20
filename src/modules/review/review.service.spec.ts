import { BadRequestException, ConflictException } from '@nestjs/common';
import { Queue } from 'bullmq';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RenderLimitException, RenderService } from '../render/render.service';
import {
  createBlankDocument,
  TemplateDocument,
} from '../template/template-document';
import { AiError } from './ai/ai-review.provider';
import { ReviewService } from './review.service';

const doc: TemplateDocument = {
  ...createBlankDocument(),
  fields: [
    {
      key: 'titulo',
      label: 'Título',
      type: 'text',
      required: true,
      maxLength: 20,
    },
  ],
  layers: [
    {
      id: 'l1',
      type: 'text',
      name: 'Título',
      x: 100,
      y: 100,
      width: 600,
      height: 150,
      text: 'x',
      fontRef: { family: 'serif' },
      fontSize: 60,
      color: { hex: '#111111' },
      bind: { fieldKey: 'titulo' },
    },
  ],
};

const tinyPng = () =>
  sharp({
    create: { width: 10, height: 10, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();

describe('ReviewService', () => {
  const prisma = {
    piece: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    review: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    reviewItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
    },
    workspace: { findUnique: jest.fn(), update: jest.fn() },
    brandKit: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const render = { renderDocument: jest.fn() };
  const config = { get: jest.fn((_k: string, d: unknown) => d) };
  const ai = { isConfigured: jest.fn(), review: jest.fn() };
  const queue = { add: jest.fn() };
  let service: ReviewService;

  const pieceRow = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    status: 'READY',
    data: { titulo: 'Conciero' },
    overrides: {},
    templateVersionId: 'v1',
    templateVersion: { document: doc },
    ...over,
  });
  const itemRow = (patch: unknown, status = 'PENDING') => ({
    id: 'i1',
    reviewId: 'r1',
    status,
    patch,
    review: { pieceId: 'p1', workspaceId: 'w1' },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockImplementation((_k: string, d: unknown) => d);
    ai.isConfigured.mockReturnValue(false);
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    prisma.piece.update.mockResolvedValue({});
    prisma.reviewItem.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'i1', ...data }),
    );
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);
    prisma.review.findFirst.mockResolvedValue(null);
    prisma.brandKit.findUnique.mockResolvedValue(null);
    service = new ReviewService(
      prisma as unknown as PrismaService,
      render as unknown as RenderService,
      config as unknown as ConfigService,
      ai,
      queue as unknown as Queue,
    );
  });

  describe('apply', () => {
    it('applies a piece_data patch to the piece data', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow({
          kind: 'piece_data',
          fieldKey: 'titulo',
          from: 'Conciero',
          to: 'Concierto',
        }),
      );
      prisma.piece.findUnique.mockResolvedValue(pieceRow());

      await service.apply('w1', 'u1', 'i1');

      const call = prisma.piece.update.mock.calls[0] as [
        { data: { data: Record<string, string> } },
      ];
      expect(call[0].data.data.titulo).toBe('Concierto');
      const item = prisma.reviewItem.update.mock.calls[0] as [
        { data: { status: string; decidedById: string } },
      ];
      expect(item[0].data).toMatchObject({
        status: 'APPLIED',
        decidedById: 'u1',
      });
    });

    it('stores layer patches as per-piece overrides, never in the template', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow({
          kind: 'layer_prop',
          layerId: 'l1',
          prop: 'fontSize',
          from: 60,
          to: 80,
        }),
      );
      prisma.piece.findUnique.mockResolvedValue(pieceRow());

      await service.apply('w1', 'u1', 'i1');

      const call = prisma.piece.update.mock.calls[0] as [
        { data: { overrides: Record<string, Record<string, unknown>> } },
      ];
      expect(call[0].data.overrides).toEqual({ l1: { fontSize: 80 } });
      expect(doc.layers[0]).toMatchObject({ fontSize: 60 });
    });

    it('answers 409 and marks the item STALE when the piece changed', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow({
          kind: 'piece_data',
          fieldKey: 'titulo',
          from: 'Conciero',
          to: 'Concierto',
        }),
      );
      prisma.piece.findUnique.mockResolvedValue(
        pieceRow({ data: { titulo: 'Otro texto' } }),
      );

      await expect(service.apply('w1', 'u1', 'i1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      const upd = prisma.reviewItem.update.mock.calls[0] as [
        { data: { status: string } },
      ];
      expect(upd[0].data.status).toBe('STALE');
      expect(prisma.piece.update).not.toHaveBeenCalled();
    });

    it('rejects advice without a patch, archived pieces and resolved items', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(itemRow(null));
      await expect(service.apply('w1', 'u1', 'i1')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow({ kind: 'piece_data', fieldKey: 'titulo', from: 'a', to: 'b' }),
      );
      prisma.piece.findUnique.mockResolvedValue(
        pieceRow({ status: 'ARCHIVED' }),
      );
      await expect(service.apply('w1', 'u1', 'i1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow(
          { kind: 'piece_data', fieldKey: 'titulo', from: 'a', to: 'b' },
          'DISMISSED',
        ),
      );
      await expect(service.apply('w1', 'u1', 'i1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses a patch whose value breaks the field rules', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow({
          kind: 'piece_data',
          fieldKey: 'titulo',
          from: 'Conciero',
          to: 'x'.repeat(50),
        }),
      );
      prisma.piece.findUnique.mockResolvedValue(pieceRow());
      await expect(service.apply('w1', 'u1', 'i1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('revert', () => {
    it('restores the previous value and returns the item to PENDING', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow(
          {
            kind: 'piece_data',
            fieldKey: 'titulo',
            from: 'Conciero',
            to: 'Concierto',
          },
          'APPLIED',
        ),
      );
      prisma.piece.findUnique.mockResolvedValue(
        pieceRow({ data: { titulo: 'Concierto' } }),
      );
      await service.revert('w1', 'u1', 'i1');
      const call = prisma.piece.update.mock.calls[0] as [
        { data: { data: Record<string, string> } },
      ];
      expect(call[0].data.data.titulo).toBe('Conciero');
    });

    it('drops the override when reverting to the template value', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow(
          {
            kind: 'layer_prop',
            layerId: 'l1',
            prop: 'fontSize',
            from: 60,
            to: 80,
          },
          'APPLIED',
        ),
      );
      prisma.piece.findUnique.mockResolvedValue(
        pieceRow({ overrides: { l1: { fontSize: 80 } } }),
      );
      await service.revert('w1', 'u1', 'i1');
      const call = prisma.piece.update.mock.calls[0] as [
        { data: { overrides: object } },
      ];
      expect(call[0].data.overrides).toEqual({});
    });

    it('refuses when the piece changed after applying', async () => {
      prisma.reviewItem.findFirst.mockResolvedValue(
        itemRow(
          { kind: 'piece_data', fieldKey: 'titulo', from: 'a', to: 'b' },
          'APPLIED',
        ),
      );
      prisma.piece.findUnique.mockResolvedValue(
        pieceRow({ data: { titulo: 'editado a mano' } }),
      );
      await expect(service.revert('w1', 'u1', 'i1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('applyMany', () => {
    it('applies what it can and reports what failed', async () => {
      prisma.review.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.reviewItem.findMany.mockResolvedValue([
        { id: 'i1' },
        { id: 'i2' },
      ]);
      prisma.reviewItem.findFirst
        .mockResolvedValueOnce(
          itemRow({
            kind: 'piece_data',
            fieldKey: 'titulo',
            from: 'Conciero',
            to: 'Concierto',
          }),
        )
        .mockResolvedValueOnce(itemRow(null));
      prisma.piece.findUnique.mockResolvedValue(pieceRow());

      const res = await service.applyMany('w1', 'u1', 'r1', [
        'i1',
        'i2',
        'foreign',
      ]);

      expect(res.applied).toEqual(['i1']);
      expect(res.failed.map((f) => f.id)).toEqual(['i2', 'foreign']);
    });
  });

  describe('request limits', () => {
    beforeEach(() => {
      prisma.piece.findFirst.mockResolvedValue(pieceRow());
      prisma.review.create.mockResolvedValue({ id: 'r1', status: 'QUEUED' });
      queue.add.mockResolvedValue({});
    });

    it('reuses a review that is already running', async () => {
      prisma.review.findFirst.mockResolvedValue({
        id: 'r0',
        status: 'RUNNING',
      });
      const res = await service.request('w1', 'u1', 'p1');
      expect(res.reused).toBe(true);
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it('answers 429 after too many reviews of the same piece in an hour', async () => {
      prisma.review.findMany.mockResolvedValue(
        Array.from({ length: 10 }, () => ({ createdAt: new Date() })),
      );
      await expect(service.request('w1', 'u1', 'p1')).rejects.toBeInstanceOf(
        RenderLimitException,
      );
    });

    it('answers 429 when the monthly AI quota is used up', async () => {
      ai.isConfigured.mockReturnValue(true);
      prisma.review.count.mockResolvedValue(100);
      await expect(service.request('w1', 'u1', 'p1')).rejects.toThrow(
        'cuota mensual',
      );
    });

    it('does not charge the AI quota when the AI is not configured', async () => {
      prisma.review.count.mockResolvedValue(100);
      const res = await service.request('w1', 'u1', 'p1');
      expect(res.reused).toBe(false);
      expect(queue.add).toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      prisma.review.updateMany.mockResolvedValue({ count: 1 });
      prisma.review.findUniqueOrThrow.mockResolvedValue({
        id: 'r1',
        workspaceId: 'w1',
        pieceId: 'p1',
      });
      prisma.piece.findUniqueOrThrow.mockResolvedValue(
        pieceRow({ data: { titulo: '' } }),
      );
      prisma.reviewItem.createMany.mockResolvedValue({ count: 1 });
      prisma.review.update.mockResolvedValue({});
      prisma.workspace.findUnique.mockResolvedValue({ aiReviewEnabled: true });
    });

    const savedReview = () =>
      (
        prisma.review.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;

    it('runs only the rules when no AI key is configured', async () => {
      await service.execute('r1');
      expect(render.renderDocument).not.toHaveBeenCalled();
      expect(savedReview()).toMatchObject({
        status: 'COMPLETED',
        aiStatus: 'SKIPPED_NO_KEY',
      });
      // required field left empty -> at least one rule finding saved
      expect(prisma.reviewItem.createMany).toHaveBeenCalled();
    });

    it('skips the AI when the workspace disabled it', async () => {
      ai.isConfigured.mockReturnValue(true);
      prisma.workspace.findUnique.mockResolvedValue({ aiReviewEnabled: false });
      await service.execute('r1');
      expect(ai.review).not.toHaveBeenCalled();
      expect(savedReview().aiStatus).toBe('DISABLED');
    });

    it('keeps the rule findings when the AI fails', async () => {
      ai.isConfigured.mockReturnValue(true);
      render.renderDocument.mockResolvedValue(await tinyPng());
      ai.review.mockRejectedValue(
        new AiError('RATE_LIMITED', 'La IA está saturada'),
      );

      await service.execute('r1');

      expect(savedReview()).toMatchObject({
        status: 'COMPLETED',
        aiStatus: 'FAILED',
        errorMessage: 'La IA está saturada',
      });
      expect(prisma.reviewItem.createMany).toHaveBeenCalled();
    });

    it('stores validated AI items with their usage', async () => {
      ai.isConfigured.mockReturnValue(true);
      render.renderDocument.mockResolvedValue(await tinyPng());
      ai.review.mockResolvedValue({
        output: {
          summary: 'Hay una falta',
          items: [
            {
              category: 'CONTENT',
              severity: 'INFO',
              title: 'Falta de ortografía',
              explanation: 'Revisa el título',
              target_layer_id: 'l1',
              target_field_key: 'titulo',
              patch_kind: 'piece_data',
              patch_field_key: 'titulo',
              patch_layer_id: '',
              patch_prop: 'none',
              patch_text: 'Concierto',
              patch_number: 0,
            },
          ],
        },
        model: 'gpt-4o',
        tokensIn: 900,
        tokensOut: 120,
      });

      await service.execute('r1');

      expect(savedReview()).toMatchObject({
        aiStatus: 'OK',
        summary: 'Hay una falta',
        model: 'gpt-4o',
        tokensIn: 900,
        tokensOut: 120,
      });
      const created = (
        prisma.reviewItem.createMany.mock.calls[0] as [
          { data: Array<{ source: string }> },
        ]
      )[0].data;
      expect(created.some((i) => i.source === 'AI')).toBe(true);
      expect(created.some((i) => i.source === 'RULE')).toBe(true);
    });

    it('does nothing if the review was already claimed', async () => {
      prisma.review.updateMany.mockResolvedValue({ count: 0 });
      await service.execute('r1');
      expect(prisma.review.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });
});
