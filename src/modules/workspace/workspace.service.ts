import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InvitationStatus, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  StorageService,
  type UploadedFile,
} from '../../infrastructure/storage/storage.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ChangeRoleDto } from './dto/change-role.dto';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}

  async create(userId: string, dto: CreateWorkspaceDto) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        description: dto.description,
        members: {
          create: {
            userId,
            role: WorkspaceRole.ADMIN,
          },
        },
      },
      include: {
        members: true,
        _count: { select: { members: true } },
      },
    });

    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      logoUrl: workspace.logoUrl,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      role: WorkspaceRole.ADMIN,
      memberCount: workspace._count.members,
    };
  }

  async findAllForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      description: m.workspace.description,
      logoUrl: m.workspace.logoUrl,
      createdAt: m.workspace.createdAt,
      updatedAt: m.workspace.updatedAt,
      role: m.role,
      memberCount: m.workspace._count.members,
    }));
  }

  async findOne(workspaceId: string, userId: string) {
    const membership = await this.requireMembership(workspaceId, userId);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { _count: { select: { members: true } } },
    });

    if (!workspace) {
      throw new NotFoundException('Espacio de trabajo no encontrado');
    }

    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      logoUrl: workspace.logoUrl,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      role: membership.role,
      memberCount: workspace._count.members,
    };
  }

  async update(workspaceId: string, userId: string, dto: UpdateWorkspaceDto) {
    await this.requireAdmin(workspaceId, userId);

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
      },
      include: { _count: { select: { members: true } } },
    });

    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      logoUrl: workspace.logoUrl,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      role: WorkspaceRole.ADMIN,
      memberCount: workspace._count.members,
    };
  }

  async uploadLogo(workspaceId: string, userId: string, file: UploadedFile) {
    await this.requireAdmin(workspaceId, userId);

    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        'Formato de imagen no permitido. Usa PNG, JPEG, WebP o SVG.',
      );
    }

    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('El logo no puede superar 2 MB');
    }

    const logoUrl = await this.storage.uploadFile(file, 'workspace-logos');

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { logoUrl },
    });

    return { logoUrl: workspace.logoUrl };
  }

  async remove(workspaceId: string, userId: string) {
    await this.requireAdmin(workspaceId, userId);
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
    return { message: 'Espacio de trabajo eliminado' };
  }

  async listMembers(workspaceId: string, userId: string) {
    await this.requireMembership(workspaceId, userId);

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            isVerified: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      fullName: m.user.fullName,
      email: m.user.email,
      status: m.user.isVerified ? 'ACTIVE' : 'PENDING_VERIFICATION',
    }));
  }

  async changeRole(
    workspaceId: string,
    requesterId: string,
    targetUserId: string,
    dto: ChangeRoleDto,
  ) {
    await this.requireAdmin(workspaceId, requesterId);

    const target = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: targetUserId },
      },
    });

    if (!target) {
      throw new NotFoundException('Miembro no encontrado en este espacio');
    }

    if (
      target.role === WorkspaceRole.ADMIN &&
      dto.role !== WorkspaceRole.ADMIN
    ) {
      await this.ensureNotLastAdmin(workspaceId, targetUserId);
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role: dto.role },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      role: updated.role,
      joinedAt: updated.joinedAt,
      fullName: updated.user.fullName,
      email: updated.user.email,
    };
  }

  async removeMember(
    workspaceId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    await this.requireAdmin(workspaceId, requesterId);

    if (requesterId === targetUserId) {
      throw new BadRequestException(
        'No puedes eliminarte a ti mismo. Usa la opción de abandonar el espacio.',
      );
    }

    const target = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: targetUserId },
      },
    });

    if (!target) {
      throw new NotFoundException('Miembro no encontrado en este espacio');
    }

    if (target.role === WorkspaceRole.ADMIN) {
      await this.ensureNotLastAdmin(workspaceId, targetUserId);
    }

    await this.prisma.workspaceMember.delete({ where: { id: target.id } });
    return { message: 'Miembro eliminado del espacio de trabajo' };
  }

  async leave(workspaceId: string, userId: string) {
    const membership = await this.requireMembership(workspaceId, userId);

    if (membership.role === WorkspaceRole.ADMIN) {
      await this.ensureNotLastAdmin(workspaceId, userId);
    }

    await this.prisma.workspaceMember.delete({ where: { id: membership.id } });
    return { message: 'Has abandonado el espacio de trabajo' };
  }

  async invite(workspaceId: string, requesterId: string, dto: InviteMemberDto) {
    await this.requireAdmin(workspaceId, requesterId);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Espacio de trabajo no encontrado');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      const alreadyMember = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: existingUser.id,
          },
        },
      });
      if (alreadyMember) {
        throw new ConflictException(
          'Este usuario ya es miembro del espacio de trabajo',
        );
      }
    }

    const pending = await this.prisma.workspaceInvitation.findFirst({
      where: {
        workspaceId,
        email: dto.email.toLowerCase(),
        status: InvitationStatus.PENDING,
      },
    });

    if (pending && pending.expiresAt > new Date()) {
      throw new ConflictException(
        'Ya existe una invitación pendiente para este correo',
      );
    }

    if (pending) {
      await this.prisma.workspaceInvitation.update({
        where: { id: pending.id },
        data: { status: InvitationStatus.CANCELLED },
      });
    }

    const inviter = await this.prisma.user.findUnique({
      where: { id: requesterId },
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        workspaceId,
        email: dto.email.toLowerCase(),
        role: dto.role,
        token,
        expiresAt,
      },
    });

    await this.mail.sendWorkspaceInvitationEmail(
      dto.email.toLowerCase(),
      workspace.name,
      inviter?.fullName ?? 'Un administrador',
      dto.role,
      token,
    );

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }

  async listInvitations(workspaceId: string, userId: string) {
    await this.requireAdmin(workspaceId, userId);

    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: {
        workspaceId,
        status: InvitationStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));
  }

  async resendInvitation(
    workspaceId: string,
    userId: string,
    invitationId: string,
  ) {
    await this.requireAdmin(workspaceId, userId);

    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: {
        id: invitationId,
        workspaceId,
        status: InvitationStatus.PENDING,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    const inviter = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const updated = await this.prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { token, expiresAt },
    });

    await this.mail.sendWorkspaceInvitationEmail(
      updated.email,
      workspace?.name ?? 'Espacio de trabajo',
      inviter?.fullName ?? 'Un administrador',
      updated.role,
      token,
    );

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      status: updated.status,
      expiresAt: updated.expiresAt,
      createdAt: updated.createdAt,
      message: 'Invitación reenviada',
    };
  }

  async cancelInvitation(
    workspaceId: string,
    userId: string,
    invitationId: string,
  ) {
    await this.requireAdmin(workspaceId, userId);

    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: {
        id: invitationId,
        workspaceId,
        status: InvitationStatus.PENDING,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }

    await this.prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.CANCELLED },
    });

    return { message: 'Invitación cancelada' };
  }

  async acceptInvitation(userId: string, token: string) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { token },
    });

    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Invitación inválida o ya utilizada');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('La invitación ha expirado');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'Esta invitación está dirigida a otro correo electrónico',
      );
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId,
        },
      },
    });

    if (existing) {
      await this.prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      });
      throw new ConflictException('Ya eres miembro de este espacio de trabajo');
    }

    await this.prisma.$transaction([
      this.prisma.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
      }),
      this.prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      }),
    ]);

    return this.findOne(invitation.workspaceId, userId);
  }

  private async requireMembership(workspaceId: string, userId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'No tienes acceso a este espacio de trabajo',
      );
    }

    return membership;
  }

  private async requireAdmin(workspaceId: string, userId: string) {
    const membership = await this.requireMembership(workspaceId, userId);
    if (membership.role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException(
        'Solo los administradores pueden realizar esta acción',
      );
    }
    return membership;
  }

  private async ensureNotLastAdmin(workspaceId: string, userId: string) {
    const adminCount = await this.prisma.workspaceMember.count({
      where: { workspaceId, role: WorkspaceRole.ADMIN },
    });

    if (adminCount <= 1) {
      throw new ConflictException(
        'No puedes abandonar ni cambiar el rol del único administrador. Transfiere la administración primero.',
      );
    }

    void userId;
  }
}
