import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsUUID,
} from 'class-validator';

export class ApplyManyDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecciona al menos una recomendación' })
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true, message: 'Identificador inválido' })
  itemIds: string[];
}

export class UpdateReviewSettingsDto {
  @ApiProperty()
  @IsBoolean({ message: 'aiEnabled debe ser booleano' })
  aiEnabled: boolean;
}
