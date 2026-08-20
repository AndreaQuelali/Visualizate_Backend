import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserThrottlerGuard } from '../../common/throttler.guards';
import {
  WorkspaceRolesGuard,
  WorkspaceRoles,
  EDITORS,
} from '../workspace/workspace-roles.guard';
import { AssetService, MAX_ASSET_BYTES } from './asset.service';
import { ListAssetsQueryDto, UploadAssetDto } from './dto/asset.dto';

interface RequestWithUser {
  user: { id: string; email: string };
}

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserThrottlerGuard, WorkspaceRolesGuard)
@Controller('workspaces/:id/assets')
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @WorkspaceRoles(...EDITORS)
  @Post()
  @ApiOperation({ summary: 'Subir un asset (ADMIN o DESIGNER)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: { type: 'string', enum: ['IMAGE', 'LOGO', 'FONT'] },
        name: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ASSET_BYTES },
    }),
  )
  upload(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
    @Body() dto: UploadAssetDto,
  ) {
    if (!file) throw new BadRequestException('Debes adjuntar un archivo');
    return this.assets.upload(id, req.user.id, file, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar assets del espacio' })
  list(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query() query: ListAssetsQueryDto,
  ) {
    return this.assets.list(id, req.user.id, query.kind);
  }

  @WorkspaceRoles(...EDITORS)
  @Delete(':assetId')
  @ApiOperation({ summary: 'Eliminar un asset (409 si está en uso)' })
  remove(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('assetId') assetId: string,
  ) {
    return this.assets.remove(id, req.user.id, assetId);
  }
}
