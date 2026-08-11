import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [TemplateController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
