import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RenderLimitFilter } from '../render/render-limit.filter';
import { ApplyManyDto, UpdateReviewSettingsDto } from './dto/review.dto';
import { ReviewService } from './review.service';

interface RequestWithUser {
  user: { id: string; email: string };
}

@ApiTags('reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseFilters(RenderLimitFilter)
@Controller('workspaces/:id')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get('review-settings')
  @ApiOperation({ summary: 'Ajustes de la revisión con IA del espacio' })
  getSettings(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.reviews.getSettings(id, req.user.id);
  }

  @Put('review-settings')
  @ApiOperation({ summary: 'Activar o desactivar la IA del espacio (ADMIN)' })
  updateSettings(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateReviewSettingsDto,
  ) {
    return this.reviews.updateSettings(id, req.user.id, dto.aiEnabled);
  }

  @Post('pieces/:pieceId/reviews')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Solicitar la revisión de una pieza' })
  request(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.reviews.request(id, req.user.id, pieceId);
  }

  @Get('pieces/:pieceId/reviews')
  @ApiOperation({ summary: 'Historial de revisiones de una pieza' })
  list(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.reviews.listForPiece(id, req.user.id, pieceId);
  }

  @Get('reviews/:reviewId')
  @ApiOperation({ summary: 'Revisión con sus recomendaciones' })
  get(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
  ) {
    return this.reviews.get(id, req.user.id, reviewId);
  }

  @Post('reviews/:reviewId/apply-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aplicar las recomendaciones elegidas' })
  applyMany(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: ApplyManyDto,
  ) {
    return this.reviews.applyMany(id, req.user.id, reviewId, dto.itemIds);
  }

  @Post('review-items/:itemId/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aplicar una recomendación a la pieza' })
  apply(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.reviews.apply(id, req.user.id, itemId);
  }

  @Post('review-items/:itemId/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Descartar una recomendación' })
  dismiss(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.reviews.dismiss(id, req.user.id, itemId);
  }

  @Post('review-items/:itemId/revert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deshacer una recomendación aplicada' })
  revert(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.reviews.revert(id, req.user.id, itemId);
  }
}
