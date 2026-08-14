import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PieceService } from './piece.service';
import {
  CreatePieceDto,
  ListPiecesQueryDto,
  UpdatePieceDto,
} from './dto/piece.dto';

interface RequestWithUser {
  user: { id: string; email: string };
}

@ApiTags('pieces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:id/pieces')
export class PieceController {
  constructor(private readonly pieces: PieceService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una pieza desde una plantilla publicada' })
  create(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: CreatePieceDto,
  ) {
    return this.pieces.create(id, req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar piezas del espacio' })
  list(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query() query: ListPiecesQueryDto,
  ) {
    return this.pieces.list(id, req.user.id, query);
  }

  @Get(':pieceId')
  @ApiOperation({ summary: 'Detalle de pieza con el documento de su versión' })
  findOne(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.pieces.findOne(id, req.user.id, pieceId);
  }

  @Patch(':pieceId')
  @ApiOperation({
    summary: 'Editar título, datos o estado (valida contra los campos)',
  })
  update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
    @Body() dto: UpdatePieceDto,
  ) {
    return this.pieces.update(id, req.user.id, pieceId, dto);
  }

  @Post(':pieceId/upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Actualizar la pieza a la última versión publicada',
  })
  upgrade(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.pieces.upgrade(id, req.user.id, pieceId);
  }

  @Delete(':pieceId')
  @ApiOperation({ summary: 'Eliminar pieza' })
  remove(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.pieces.remove(id, req.user.id, pieceId);
  }
}
