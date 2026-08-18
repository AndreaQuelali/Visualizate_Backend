import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RenderFormat } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { ALLOWED_SCALES } from '../render.constants';

export class RequestRenderDto {
  @ApiProperty({ enum: RenderFormat })
  @IsEnum(RenderFormat, { message: 'Formato inválido (PNG o PDF)' })
  format: RenderFormat;

  @ApiPropertyOptional({
    description: 'Solo PNG: 1, 2 o 3 (por defecto 1)',
    enum: ALLOWED_SCALES,
  })
  @IsOptional()
  @IsIn([...ALLOWED_SCALES], {
    message: 'La escala debe ser 1, 2 o 3',
  })
  scale?: number;
}
