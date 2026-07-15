import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
} from '../../../shared/decorators/current-user.decorator';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { SummaryAttendanceDto } from './dto/summary-attendance.dto';

@ApiTags('working / attendance')
@ApiBearerAuth()
@Controller('working/attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  // ---- Employee self-service ----
  @Post('check-in')
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckInDto) {
    return this.service.checkIn(user, dto);
  }

  @Post('check-out')
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: CheckOutDto) {
    return this.service.checkOut(user, dto);
  }

  @Get('today')
  today(@CurrentUser() user: AuthUser) {
    return this.service.today(user);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() query: QueryAttendanceDto) {
    return this.service.history(user, query);
  }

  /** Day counts for the caller's own month (defaults to the current month). */
  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() query: SummaryAttendanceDto) {
    return this.service.summary(user, query);
  }

  // ---- Admin / manager reporting ----
  @Roles(Role.admin)
  @Get()
  list(@Query() query: QueryAttendanceDto) {
    return this.service.list(query);
  }

  /**
   * Backfills "absent" rows over a date range (weekends skipped). The nightly
   * cron covers new days; this is for historical gaps and manual re-runs.
   * Idempotent — safe to run repeatedly.
   */
  @Roles(Role.admin)
  @Post('mark-absent')
  markAbsent(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.service.markAbsentRange(dateFrom, dateTo);
  }
}
