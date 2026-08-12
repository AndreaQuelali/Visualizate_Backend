import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/** Roles that can manage templates and assets. */
export const EDITOR_ROLES: WorkspaceRole[] = [
  WorkspaceRole.ADMIN,
  WorkspaceRole.DESIGNER,
];

/**
 * Reusable workspace membership / role checks for feature modules.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireMember(workspaceId: string, userId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException(
        'No tienes acceso a este espacio de trabajo',
      );
    }
    return membership;
  }

  async requireRole(
    workspaceId: string,
    userId: string,
    roles: WorkspaceRole[],
  ) {
    const membership = await this.requireMember(workspaceId, userId);
    if (!roles.includes(membership.role)) {
      throw new ForbiddenException(
        'Tu rol no tiene permiso para realizar esta acción',
      );
    }
    return membership;
  }
}
