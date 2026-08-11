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
import { BrandService } from './brand.service';
import { UpdateBrandDto } from './dto/update-brand.dto';

interface RequestWithUser {
  user: { id: string; email: string };
}

@ApiTags('brand')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:id/brand')
export class BrandController {
  constructor(private readonly brand: BrandService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener el kit de marca del espacio' })
  get(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.brand.get(id, req.user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Guardar el kit de marca (solo ADMIN)' })
  update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brand.update(id, req.user.id, dto);
  }
}
