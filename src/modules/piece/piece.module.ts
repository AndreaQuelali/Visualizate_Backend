import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { PieceController } from './piece.controller';
import { PieceService } from './piece.service';

@Module({
  imports: [WorkspaceModule, StorageModule],
  controllers: [PieceController],
  providers: [PieceService],
  exports: [PieceService],
})
export class PieceModule {}
