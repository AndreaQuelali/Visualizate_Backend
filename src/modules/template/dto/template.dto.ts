import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTemplateDto {
  @ApiProperty({ example: 'Flyer de evento' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido' })
  @MaxLength(100, { message: 'El nombre no puede superar 100 caracteres' })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'La descripción no puede superar 500 caracteres',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'TemplateDocument; por defecto, lienzo en blanco 1080x1080',
  })
  @IsOptional()
  @IsObject({ message: 'El documento debe ser un objeto' })
  document?: Record<string, unknown>;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(100, { message: 'El nombre no puede superar 100 caracteres' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'La descripción no puede superar 500 caracteres',
  })
  description?: string;

  @ApiPropertyOptional({ description: 'true archiva, false restaura' })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class SaveDraftDto {
  @ApiProperty({ description: 'TemplateDocument completo' })
  @IsObject({ message: 'El documento debe ser un objeto' })
  document: Record<string, unknown>;
}

export class ListTemplatesQueryDto {
  @ApiPropertyOptional({ enum: TemplateStatus })
  @IsOptional()
  @IsEnum(TemplateStatus, { message: 'Estado inválido' })
  status?: TemplateStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
