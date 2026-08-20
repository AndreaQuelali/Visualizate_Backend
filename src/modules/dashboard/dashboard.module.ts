import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { QuotaModule } from '../quota/quota.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [StorageModule, QuotaModule, WorkspaceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
