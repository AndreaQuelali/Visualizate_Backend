import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInvitationDto {
  @ApiProperty({ example: 'a1b2c3d4-token' })
  @IsString()
  @IsNotEmpty({ message: 'El token de invitación es requerido' })
  token: string;
}
