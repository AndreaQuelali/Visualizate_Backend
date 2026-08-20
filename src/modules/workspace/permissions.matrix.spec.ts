import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AssetController } from '../asset/asset.controller';
import { BrandController } from '../brand/brand.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { PieceController } from '../piece/piece.controller';
import { RenderController } from '../render/render.controller';
import { ReviewController } from '../review/review.controller';
import { TemplateController } from '../template/template.controller';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceAccessService } from './workspace-access.service';
import { WorkspaceRolesGuard } from './workspace-roles.guard';

type Ctor = new (...args: never[]) => object;
type Level = 'ADMIN' | 'EDITOR' | 'MEMBER';

const { ADMIN, DESIGNER, ORGANIZER } = WorkspaceRole;
const ALLOWED: Record<Level, WorkspaceRole[]> = {
  ADMIN: [ADMIN],
  EDITOR: [ADMIN, DESIGNER],
  MEMBER: [ADMIN, DESIGNER, ORGANIZER],
};

/**
 * The permission matrix of the product, endpoint by endpoint. The minimum
 * level a role needs to call each handler of every workspace-scoped controller.
 */
const MATRIX: [Ctor, Record<string, Level>][] = [
  [AssetController, { upload: 'EDITOR', list: 'MEMBER', remove: 'EDITOR' }],
  [BrandController, { get: 'MEMBER', update: 'ADMIN' }],
  [
    PieceController,
    {
      create: 'MEMBER',
      list: 'MEMBER',
      findOne: 'MEMBER',
      update: 'MEMBER',
      upgrade: 'MEMBER',
      remove: 'MEMBER',
    },
  ],
  [
    RenderController,
    {
      request: 'MEMBER',
      list: 'MEMBER',
      get: 'MEMBER',
      download: 'MEMBER',
      cancel: 'MEMBER',
    },
  ],
  [
    ReviewController,
    {
      getSettings: 'MEMBER',
      updateSettings: 'ADMIN',
      request: 'MEMBER',
      list: 'MEMBER',
      get: 'MEMBER',
      applyMany: 'MEMBER',
      apply: 'MEMBER',
      dismiss: 'MEMBER',
      revert: 'MEMBER',
    },
  ],
  [
    TemplateController,
    {
      list: 'MEMBER',
      create: 'EDITOR',
      findOne: 'MEMBER',
      update: 'EDITOR',
      remove: 'EDITOR',
      saveDraft: 'EDITOR',
      publish: 'EDITOR',
      duplicate: 'EDITOR',
    },
  ],
  [DashboardController, { get: 'MEMBER' }],
  [
    WorkspaceController,
    {
      findOne: 'MEMBER',
      update: 'ADMIN',
      uploadLogo: 'ADMIN',
      remove: 'ADMIN',
      listMembers: 'MEMBER',
      changeRole: 'ADMIN',
      leave: 'MEMBER',
      removeMember: 'ADMIN',
      invite: 'ADMIN',
      listInvitations: 'ADMIN',
      resendInvitation: 'ADMIN',
      cancelInvitation: 'ADMIN',
    },
  ],
];

/** Handlers that live under a workspace route and are not covered by `:id`. */
const NOT_WORKSPACE_SCOPED = new Set([
  'WorkspaceController.create',
  'WorkspaceController.findAll',
  'WorkspaceController.acceptInvitation',
]);

function handlersOf(ctor: Ctor): string[] {
  const proto = ctor.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      typeof proto[name] === 'function' &&
      Reflect.getMetadata('path', proto[name] as object) !== undefined,
  );
}

function contextFor(
  ctor: Ctor,
  handler: string,
  userId: string,
  workspaceId: string,
) {
  const proto = ctor.prototype as Record<string, () => void>;
  const request = { user: { id: userId }, params: { id: workspaceId } };
  const context = {
    getHandler: () => proto[handler],
    getClass: () => ctor,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('Workspace permission matrix (role × endpoint)', () => {
  const prisma = { workspaceMember: { findUnique: jest.fn() } };
  const guard = new WorkspaceRolesGuard(
    new Reflector(),
    new WorkspaceAccessService(prisma as unknown as PrismaService),
  );

  function memberAs(role: WorkspaceRole | null) {
    prisma.workspaceMember.findUnique.mockResolvedValue(
      role ? { workspaceId: 'w1', userId: 'u1', role } : null,
    );
  }

  const cases = MATRIX.flatMap(([ctor, handlers]) =>
    Object.entries(handlers).flatMap(([handler, level]) =>
      (Object.values(WorkspaceRole) as WorkspaceRole[]).map(
        (role) =>
          [ctor.name, handler, level, role, ALLOWED[level].includes(role)] as [
            string,
            string,
            Level,
            WorkspaceRole,
            boolean,
          ],
      ),
    ),
  );

  it.each(cases)(
    '%s.%s (needs %s) as %s → allowed=%s',
    async (ctorName, handler, _level, role, allowed) => {
      const ctor = MATRIX.find(([c]) => c.name === ctorName)![0];
      memberAs(role);
      const { context, request } = contextFor(ctor, handler, 'u1', 'w1');
      if (allowed) {
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request).toHaveProperty('workspaceMember.role', role);
      } else {
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
    },
  );

  it.each(MATRIX.map(([ctor]) => [ctor.name, ctor] as const))(
    '%s rejects someone who is not a member of the workspace',
    async (_name, ctor) => {
      memberAs(null);
      const [first] = Object.keys(MATRIX.find(([c]) => c === ctor)![1]);
      const { context } = contextFor(ctor, first, 'u1', 'w1');
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('lists every handler of every controller in the matrix', () => {
    for (const [ctor, handlers] of MATRIX) {
      const routed = handlersOf(ctor).filter(
        (h) => !NOT_WORKSPACE_SCOPED.has(`${ctor.name}.${h}`),
      );
      expect(Object.keys(handlers).sort()).toEqual(routed.sort());
    }
  });

  it('answers 403 to an ORGANIZER creating a template through the API', async () => {
    memberAs(ORGANIZER);
    const { context } = contextFor(TemplateController, 'create', 'u1', 'w1');
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Tu rol no tiene permiso para realizar esta acción',
    );
  });
});
