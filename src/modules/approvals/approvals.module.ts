import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ApproverLookupService } from './approver-lookup.service';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

/**
 * Leave + emergency approval workflow.
 *   - config (admin): leave chain, leave/emergency types, emergency approver pool
 *   - requests (employee/approver): submit, my requests, inbox, approve/reject
 */
@Module({
  // UsersModule: requests resolve the requester's email from their login account.
  imports: [NotificationsModule, UsersModule],
  controllers: [ConfigController, RequestsController],
  providers: [ConfigService, RequestsService, ApproverLookupService],
})
export class ApprovalsModule {}
