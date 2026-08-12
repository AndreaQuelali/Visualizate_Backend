import { ApiPropertyOptional } from '@nestjs/swagger';
import { AssetKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadAssetDto {
  @ApiPropertyOptional({ enum: AssetKind })
  @IsOptional()
  @IsEnum(AssetKind, { message: 'Tipo de asset inválido' })
  kind?: AssetKind;

  @ApiPropertyOptional({ example: 'Logo principal' })
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'El nombre no puede superar 120 caracteres' })
  name?: string;
}

export class ListAssetsQueryDto {
  @ApiPropertyOptional({ enum: AssetKind })
  @IsOptional()
  @IsEnum(AssetKind, { message: 'Tipo de asset inválido' })
  kind?: AssetKind;
}
