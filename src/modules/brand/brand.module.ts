import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { BrandController } from './brand.controller';
import { BrandService } from './brand.service';

@Module({
  imports: [StorageModule, WorkspaceModule],
  controllers: [BrandController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
