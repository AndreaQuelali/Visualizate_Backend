import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserThrottlerGuard } from '../../common/throttler.guards';
import {
  WorkspaceRolesGuard,
  WorkspaceRoles,
  ADMIN_ONLY,
} from '../workspace/workspace-roles.guard';
import { BrandService } from './brand.service';
import { UpdateBrandDto } from './dto/update-brand.dto';

interface RequestWithUser {
  user: { id: string; email: string };
}

@ApiTags('brand')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserThrottlerGuard, WorkspaceRolesGuard)
@Controller('workspaces/:id/brand')
export class BrandController {
  constructor(private readonly brand: BrandService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener el kit de marca del espacio' })
  get(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.brand.get(id);
  }

  @WorkspaceRoles(...ADMIN_ONLY)
  @Put()
  @ApiOperation({ summary: 'Guardar el kit de marca (solo ADMIN)' })
  update(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.brand.update(id, dto);
  }
}
