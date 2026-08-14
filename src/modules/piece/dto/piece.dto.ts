import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PieceStatus } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePieceDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Plantilla inválida' })
  templateId: string;

  @ApiProperty({ example: 'Flyer concierto 12 de mayo' })
  @IsString()
  @IsNotEmpty({ message: 'El título es requerido' })
  @MaxLength(120, { message: 'El título no puede superar 120 caracteres' })
  title: string;
}

export class UpdatePieceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  @MaxLength(120, { message: 'El título no puede superar 120 caracteres' })
  title?: string;

  @ApiPropertyOptional({ description: 'Valores por clave de campo' })
  @IsOptional()
  @IsObject({ message: 'Los datos deben ser un objeto' })
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: PieceStatus })
  @IsOptional()
  @IsEnum(PieceStatus, { message: 'Estado inválido' })
  status?: PieceStatus;
}

export class ListPiecesQueryDto {
  @ApiPropertyOptional({ enum: PieceStatus })
  @IsOptional()
  @IsEnum(PieceStatus, { message: 'Estado inválido' })
  status?: PieceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
