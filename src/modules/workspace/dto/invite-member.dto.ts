import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';

export class InviteMemberDto {
  @ApiProperty({ example: 'colaborador@empresa.com' })
  @IsEmail({}, { message: 'El correo electrónico debe ser válido' })
  @IsNotEmpty({ message: 'El correo electrónico es requerido' })
  email: string;

  @ApiProperty({ enum: WorkspaceRole, example: WorkspaceRole.DESIGNER })
  @IsEnum(WorkspaceRole, {
    message: 'El rol debe ser ADMIN, DESIGNER u ORGANIZER',
  })
  role: WorkspaceRole;
}
