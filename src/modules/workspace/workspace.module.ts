import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../../infrastructure/mail/mail.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceAccessService } from './workspace-access.service';

@Module({
  imports: [AuthModule, MailModule, StorageModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceAccessService],
  exports: [WorkspaceService, WorkspaceAccessService],
})
export class WorkspaceModule {}
