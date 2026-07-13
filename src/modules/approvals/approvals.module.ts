import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApproverLookupService } from './approver-lookup.service';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

/**
 * Leave + sick approval workflow.
 *   - config (admin): leave chain, sick types, sick approver pool
 *   - requests (employee/approver): submit, my requests, inbox, approve/reject
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ConfigController, RequestsController],
  providers: [ConfigService, RequestsService, ApproverLookupService],
})
export class ApprovalsModule {}
