import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const COLOR_ROLES = [
  'PRIMARY',
  'SECONDARY',
  'ACCENT',
  'NEUTRAL',
] as const;

export class BrandColorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Indigo marca' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del color es requerido' })
  @MaxLength(60, { message: 'El nombre no puede superar 60 caracteres' })
  name: string;

  @ApiProperty({ example: '#4648d4' })
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'El color debe ser #RRGGBB' })
  hex: string;

  @ApiProperty({ enum: COLOR_ROLES })
  @IsIn(COLOR_ROLES, { message: 'Rol de color inválido' })
  role: (typeof COLOR_ROLES)[number];
}

export class BrandFontDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Inter' })
  @IsString()
  @IsNotEmpty({ message: 'La familia de la fuente es requerida' })
  @MaxLength(80, { message: 'La familia no puede superar 80 caracteres' })
  family: string;

  @ApiProperty({ example: [400, 700] })
  @IsArray()
  @ArrayMaxSize(9)
  @IsInt({ each: true, message: 'Los pesos deben ser enteros' })
  @Min(100, { each: true, message: 'Peso mínimo 100' })
  @Max(900, { each: true, message: 'Peso máximo 900' })
  weights: number[];

  @ApiPropertyOptional({ description: 'Asset de tipo FONT' })
  @IsOptional()
  @IsString()
  assetId?: string;
}

export class UpdateBrandDto {
  @ApiProperty({ type: [BrandColorDto] })
  @IsArray()
  @ArrayMaxSize(24, { message: 'Máximo 24 colores' })
  @ValidateNested({ each: true })
  @Type(() => BrandColorDto)
  colors: BrandColorDto[];

  @ApiProperty({ type: [BrandFontDto] })
  @IsArray()
  @ArrayMaxSize(12, { message: 'Máximo 12 fuentes' })
  @ValidateNested({ each: true })
  @Type(() => BrandFontDto)
  fonts: BrandFontDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  logoAssetId?: string | null;
}
