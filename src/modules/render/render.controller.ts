import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserThrottlerGuard } from '../../common/throttler.guards';
import { WorkspaceRolesGuard } from '../workspace/workspace-roles.guard';
import { RequestRenderDto } from './dto/render.dto';
import { RenderLimitFilter } from './render-limit.filter';
import { RenderService } from './render.service';

interface RequestWithUser {
  user: { id: string; email: string };
}

@ApiTags('render')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserThrottlerGuard, WorkspaceRolesGuard)
@UseFilters(RenderLimitFilter)
@Controller('workspaces/:id')
export class RenderController {
  constructor(private readonly render: RenderService) {}

  @Post('pieces/:pieceId/render')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Solicitar la exportación de una pieza (PNG o PDF)',
  })
  request(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
    @Body() dto: RequestRenderDto,
  ) {
    return this.render.request(id, req.user.id, pieceId, dto);
  }

  @Get('pieces/:pieceId/render-jobs')
  @ApiOperation({ summary: 'Historial de exportaciones de una pieza' })
  list(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.render.listForPiece(id, req.user.id, pieceId);
  }

  @Get('render-jobs/:jobId')
  @ApiOperation({ summary: 'Estado de una exportación' })
  get(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.render.get(id, req.user.id, jobId);
  }

  @Get('render-jobs/:jobId/download')
  @ApiOperation({ summary: 'URL firmada (5 min) para descargar el archivo' })
  download(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.render.download(id, req.user.id, jobId);
  }

  @Post('render-jobs/:jobId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una exportación en cola o en curso' })
  cancel(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.render.cancel(id, req.user.id, jobId);
  }
}
