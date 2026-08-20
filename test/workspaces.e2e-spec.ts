import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, WorkspaceRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { createBlankDocument } from '../src/modules/template/template-document';

type Who = 'admin' | 'designer' | 'organizer' | 'outsider';

/**
 * End-to-end checks against a real database: tenant isolation, the role
 * matrix over HTTP, quotas and the dashboard aggregation.
 * Requires PostgreSQL, Redis and MinIO (see docker-compose.yml).
 */
describe('Workspaces (e2e)', () => {
  const tag = `e2e${Date.now()}`;
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;

  const ids = { wsA: '', wsB: '', published: '' };
  const tokens = {} as Record<Who, string>;
  const auth = (who: Who) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(key: Who) {
    const email = `${tag}-${key}@example.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: 'x', fullName: key, isVerified: true },
    });
    tokens[key] = jwt.sign({ sub: user.id, email });
    return user.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService, { strict: false });

    const admin = await createUser('admin');
    const designer = await createUser('designer');
    const organizer = await createUser('organizer');
    const outsider = await createUser('outsider');

    const wsA = await prisma.workspace.create({
      data: {
        name: `${tag}-A`,
        members: {
          create: [
            { userId: admin, role: WorkspaceRole.ADMIN },
            { userId: designer, role: WorkspaceRole.DESIGNER },
            { userId: organizer, role: WorkspaceRole.ORGANIZER },
          ],
        },
      },
    });
    const wsB = await prisma.workspace.create({
      data: {
        name: `${tag}-B`,
        members: { create: [{ userId: outsider, role: WorkspaceRole.ADMIN }] },
      },
    });
    ids.wsA = wsA.id;
    ids.wsB = wsB.id;

    const template = await prisma.template.create({
      data: {
        workspaceId: wsA.id,
        name: 'Publicada',
        status: 'PUBLISHED',
        createdById: admin,
      },
    });
    const version = await prisma.templateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        document: createBlankDocument() as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
        createdById: admin,
      },
    });
    await prisma.template.update({
      where: { id: template.id },
      data: { currentVersionId: version.id },
    });
    ids.published = template.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [ids.wsA, ids.wsB].filter(Boolean) } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await app.close();
  });

  describe('permissions over HTTP', () => {
    it('an ORGANIZER gets 403 creating a template through the API', () =>
      request(app.getHttpServer())
        .post(`/workspaces/${ids.wsA}/templates`)
        .set(auth('organizer'))
        .send({ name: 'No debería' })
        .expect(403));

    it('a DESIGNER can create a template', () =>
      request(app.getHttpServer())
        .post(`/workspaces/${ids.wsA}/templates`)
        .set(auth('designer'))
        .send({ name: 'Del diseñador' })
        .expect(201));

    it('only an ADMIN edits the brand kit', async () => {
      const body = { colors: [], fonts: [] };
      await request(app.getHttpServer())
        .put(`/workspaces/${ids.wsA}/brand`)
        .set(auth('designer'))
        .send(body)
        .expect(403);
      await request(app.getHttpServer())
        .put(`/workspaces/${ids.wsA}/brand`)
        .set(auth('admin'))
        .send(body)
        .expect(200);
    });

    it('an ORGANIZER can read the workspace dashboard', () =>
      request(app.getHttpServer())
        .get(`/workspaces/${ids.wsA}/dashboard`)
        .set(auth('organizer'))
        .expect(200));
  });

  describe('tenant isolation', () => {
    it('a member of another workspace gets 403 on every area', async () => {
      for (const path of [
        'dashboard',
        'templates',
        'pieces',
        'assets',
        'brand',
        'members',
      ]) {
        await request(app.getHttpServer())
          .get(`/workspaces/${ids.wsA}/${path}`)
          .set(auth('outsider'))
          .expect(403);
      }
    });

    it('a template of A is not reachable through workspace B', () =>
      request(app.getHttpServer())
        .get(`/workspaces/${ids.wsB}/templates/${ids.published}`)
        .set(auth('outsider'))
        .expect(404));

    it('rejects requests without a token', () =>
      request(app.getHttpServer())
        .get(`/workspaces/${ids.wsA}/dashboard`)
        .expect(401));
  });

  describe('quotas and dashboard', () => {
    const createPiece = (title: string) =>
      request(app.getHttpServer())
        .post(`/workspaces/${ids.wsA}/pieces`)
        .set(auth('organizer'))
        .send({ templateId: ids.published, title });

    it('answers 402 with a clear body once the active pieces limit is hit', async () => {
      for (let i = 1; i <= 3; i++) await createPiece(`Pieza ${i}`).expect(201);

      const res = await createPiece('Pieza extra').expect(402);
      expect(res.body).toMatchObject({
        statusCode: 402,
        code: 'QUOTA_EXCEEDED',
        resource: 'activePieces',
        limit: 3,
        used: 3,
      });
      expect(res.body).toHaveProperty('message');
    });

    it('the dashboard matches the database', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ids.wsA}/dashboard`)
        .set(auth('admin'))
        .expect(200);
      const body = res.body as {
        onboarding: { template: boolean; piece: boolean };
        recentPieces: { title: string }[];
        topTemplates: { id: string; piecesCount: number }[];
        usage: { activePieces: { used: number; limit: number } };
      };
      const count = await prisma.piece.count({
        where: { workspaceId: ids.wsA },
      });
      expect(count).toBe(3);
      expect(body.onboarding).toMatchObject({ template: true, piece: true });
      expect(body.recentPieces).toHaveLength(3);
      expect(body.topTemplates[0]).toMatchObject({
        id: ids.published,
        piecesCount: 3,
      });
      expect(body.usage.activePieces).toEqual({ used: 3, limit: 3 });
    });

    it('a brand-new workspace has an empty dashboard', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ids.wsB}/dashboard`)
        .set(auth('outsider'))
        .expect(200);
      expect(res.body).toMatchObject({
        onboarding: { brand: false, template: false, piece: false },
        recentPieces: [],
        topTemplates: [],
        recentRenders: [],
        pendingReviews: [],
      });
    });
  });

  describe('health', () => {
    it('reports every dependency as up', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        info: {
          database: { status: 'up' },
          redis: { status: 'up' },
          storage: { status: 'up' },
        },
      });
    });
  });
});
