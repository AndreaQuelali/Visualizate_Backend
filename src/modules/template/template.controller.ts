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
import { TemplateService } from './template.service';
import {
  CreateTemplateDto,
  ListTemplatesQueryDto,
  SaveDraftDto,
  UpdateTemplateDto,
} from './dto/template.dto';

interface RequestWithUser {
  user: { id: string; email: string };
}

@ApiTags('templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:id/templates')
export class TemplateController {
  constructor(private readonly templates: TemplateService) {}

  @Get()
  @ApiOperation({ summary: 'Listar plantillas del espacio' })
  list(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query() query: ListTemplatesQueryDto,
  ) {
    return this.templates.list(id, req.user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Crear plantilla (ADMIN o DESIGNER)' })
  create(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.templates.create(id, req.user.id, dto);
  }

  @Get(':tplId')
  @ApiOperation({ summary: 'Detalle de plantilla con su último documento' })
  findOne(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tplId') tplId: string,
  ) {
    return this.templates.findOne(id, req.user.id, tplId);
  }

  @Patch(':tplId')
  @ApiOperation({ summary: 'Renombrar, describir, archivar o restaurar' })
  update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tplId') tplId: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(id, req.user.id, tplId, dto);
  }

  @Delete(':tplId')
  @ApiOperation({ summary: 'Eliminar plantilla' })
  remove(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tplId') tplId: string,
  ) {
    return this.templates.remove(id, req.user.id, tplId);
  }

  @Post(':tplId/versions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Guardar borrador (actualiza el borrador abierto o crea la siguiente versión)',
  })
  saveDraft(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tplId') tplId: string,
    @Body() dto: SaveDraftDto,
  ) {
    return this.templates.saveDraft(id, req.user.id, tplId, dto.document);
  }

  @Post(':tplId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publicar el borrador como versión inmutable' })
  publish(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tplId') tplId: string,
  ) {
    return this.templates.publish(id, req.user.id, tplId);
  }

  @Post(':tplId/duplicate')
  @ApiOperation({ summary: 'Duplicar plantilla' })
  duplicate(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tplId') tplId: string,
  ) {
    return this.templates.duplicate(id, req.user.id, tplId);
  }
}
