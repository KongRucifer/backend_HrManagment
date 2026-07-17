import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { BirthdayReminderService } from './birthday-reminder.service';
import { ContractReminderService } from './contract-reminder.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    ContractReminderService,
    BirthdayReminderService,
  ],
  exports: [EmployeesService],
})
export class EmployeesModule {}
