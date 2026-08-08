import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceService } from './workspace.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import type { UploadedFile as StorageUploadedFile } from '../../infrastructure/storage/storage.service';

interface RequestWithUser {
  user: {
    id: string;
    email: string;
  };
}

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@ApiTags('workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un espacio de trabajo' })
  @ApiResponse({
    status: 201,
    description: 'Espacio creado. El creador es ADMIN.',
  })
  create(@Request() req: RequestWithUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaceService.create(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar espacios de trabajo del usuario' })
  @ApiResponse({
    status: 200,
    description: 'Lista de workspaces con rol y miembros.',
  })
  findAll(@Request() req: RequestWithUser) {
    return this.workspaceService.findAllForUser(req.user.id);
  }

  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aceptar invitación a un espacio de trabajo' })
  @ApiResponse({ status: 200, description: 'Invitación aceptada.' })
  acceptInvitation(
    @Request() req: RequestWithUser,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.workspaceService.acceptInvitation(req.user.id, dto.token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un espacio de trabajo' })
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.workspaceService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar espacio de trabajo (solo ADMIN)' })
  update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaceService.update(id, req.user.id, dto);
  }

  @Post(':id/logo')
  @ApiOperation({ summary: 'Subir logo del espacio de trabajo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
  ) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo de imagen');
    }
    const payload: StorageUploadedFile = {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size,
    };
    return this.workspaceService.uploadLogo(id, req.user.id, payload);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar espacio de trabajo (solo ADMIN)' })
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.workspaceService.remove(id, req.user.id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Listar miembros del espacio' })
  listMembers(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.workspaceService.listMembers(id, req.user.id);
  }

  @Patch(':id/members/:userId/role')
  @ApiOperation({ summary: 'Cambiar rol de un miembro (solo ADMIN)' })
  changeRole(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.workspaceService.changeRole(id, req.user.id, userId, dto);
  }

  @Delete(':id/members/me')
  @ApiOperation({ summary: 'Abandonar el espacio de trabajo' })
  leave(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.workspaceService.leave(id, req.user.id);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Eliminar un miembro (solo ADMIN)' })
  removeMember(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.workspaceService.removeMember(id, req.user.id, userId);
  }

  @Post(':id/invitations')
  @ApiOperation({ summary: 'Invitar un miembro al espacio' })
  invite(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspaceService.invite(id, req.user.id, dto);
  }

  @Get(':id/invitations')
  @ApiOperation({ summary: 'Listar invitaciones pendientes' })
  listInvitations(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.workspaceService.listInvitations(id, req.user.id);
  }

  @Post(':id/invitations/:invId/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenviar invitación pendiente' })
  resendInvitation(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('invId') invId: string,
  ) {
    return this.workspaceService.resendInvitation(id, req.user.id, invId);
  }

  @Delete(':id/invitations/:invId')
  @ApiOperation({ summary: 'Cancelar invitación pendiente' })
  cancelInvitation(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('invId') invId: string,
  ) {
    return this.workspaceService.cancelInvitation(id, req.user.id, invId);
  }
}
