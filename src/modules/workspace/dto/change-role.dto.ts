import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';

export class ChangeRoleDto {
  @ApiProperty({ enum: WorkspaceRole, example: WorkspaceRole.ORGANIZER })
  @IsEnum(WorkspaceRole, {
    message: 'El rol debe ser ADMIN, DESIGNER u ORGANIZER',
  })
  @IsNotEmpty({ message: 'El rol es requerido' })
  role: WorkspaceRole;
}
