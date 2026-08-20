import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceMember, WorkspaceRole } from '@prisma/client';
import { WorkspaceAccessService } from './workspace-access.service';

export const WORKSPACE_ROLES_KEY = 'workspaceRoles';

/**
 * Restricts a route (or a whole controller) to workspace members holding one
 * of the given roles. Without arguments any member of the workspace is allowed.
 * The workspace is read from the `:id` route param.
 */
export const WorkspaceRoles = (...roles: WorkspaceRole[]) =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);

/** Role groups that mirror the permission matrix of the product. */
export const ADMIN_ONLY: WorkspaceRole[] = [WorkspaceRole.ADMIN];
export const EDITORS: WorkspaceRole[] = [
  WorkspaceRole.ADMIN,
  WorkspaceRole.DESIGNER,
];
export const ANY_MEMBER: WorkspaceRole[] = [];

export interface RequestWithWorkspaceMember {
  user?: { id: string };
  params: { id?: string };
  workspaceMember?: WorkspaceMember;
}

/**
 * Validates that the authenticated user belongs to the workspace in the URL
 * **and** has one of the roles declared with `@WorkspaceRoles(...)`.
 * Must run after `JwtAuthGuard`.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: WorkspaceAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles =
      this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(
        WORKSPACE_ROLES_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    const request = context
      .switchToHttp()
      .getRequest<RequestWithWorkspaceMember>();
    const workspaceId = request.params.id;
    const userId = request.user?.id;

    if (!workspaceId || !userId) {
      throw new ForbiddenException(
        'No tienes acceso a este espacio de trabajo',
      );
    }

    request.workspaceMember =
      roles.length > 0
        ? await this.access.requireRole(workspaceId, userId, roles)
        : await this.access.requireMember(workspaceId, userId);
    return true;
  }
}
