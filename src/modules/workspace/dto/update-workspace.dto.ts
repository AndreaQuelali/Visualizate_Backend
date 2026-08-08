import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ example: 'Equipo Marketing' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'El nombre no puede superar 100 caracteres' })
  name?: string;

  @ApiPropertyOptional({ example: 'Espacio para campañas visuales del equipo' })
  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'La descripción no puede superar 500 caracteres',
  })
  description?: string;
}
