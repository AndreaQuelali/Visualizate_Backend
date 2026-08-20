import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserThrottlerGuard } from '../../common/throttler.guards';
import {
  ANY_MEMBER,
  WorkspaceRoles,
  WorkspaceRolesGuard,
} from '../workspace/workspace-roles.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserThrottlerGuard, WorkspaceRolesGuard)
@Controller('workspaces/:id/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @WorkspaceRoles(...ANY_MEMBER)
  @Get()
  @ApiOperation({
    summary:
      'Resumen del espacio: piezas recientes, plantillas, exportaciones, revisiones y consumo',
  })
  get(@Param('id') id: string) {
    return this.dashboard.get(id);
  }
}
