import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { ScheduleController } from './schedule/schedule.controller';
import { ScheduleService } from './schedule/schedule.service';
import { WifiController } from './wifi/wifi.controller';
import { WifiService } from './wifi/wifi.service';

/**
 * "working" feature — everything about check-in / check-out lives here:
 *   - attendance/  → the check-in & check-out logic (WiFi-gated)
 *   - wifi/        → allowed office WiFi networks
 *   - schedule/    → work shifts (used to flag late check-ins)
 *
 * New features (e.g. training-course, recruitment) are separate modules
 * that sit NEXT TO this one under src/modules/.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [AttendanceController, WifiController, ScheduleController],
  providers: [AttendanceService, WifiService, ScheduleService],
  exports: [AttendanceService, WifiService, ScheduleService],
})
export class WorkingModule {}
