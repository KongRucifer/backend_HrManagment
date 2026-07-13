import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Attendance, AttendanceStatus, Prisma, WorkSchedule } from '@prisma/client';
import { AuthUser } from '../../../shared/decorators/current-user.decorator';
import { PaginatedResult } from '../../../shared/dto/pagination.dto';
import {
  diffHours,
  getWorkDate,
  timeOnDateToInstant,
  toDateOnly,
} from '../../../shared/utils/datetime.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeesService } from '../../employees/employees.service';
import { WifiService } from '../wifi/wifi.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wifiService: WifiService,
    private readonly employeesService: EmployeesService,
  ) {}

  /** The employee performs a check-in (must be on office WiFi). */
  async checkIn(user: AuthUser, dto: CheckInDto): Promise<Attendance> {
    const employeeId = this.requireEmployee(user);

    // 1) WiFi gate — server-side verification.
    const wifi = await this.wifiService.verifyOrThrow(dto.ssid, dto.bssid);

    // 2) One record per employee per day.
    const workDateStr = getWorkDate();
    const workDate = toDateOnly(workDateStr);
    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
    });
    if (existing && existing.checkInTime) {
      throw new ConflictException('common.errors.already_checked_in');
    }

    const now = new Date();
    const employee = await this.employeesService.findOne(employeeId);
    const status = this.resolveStatus(now, workDateStr, employee.workSchedule);

    return this.prisma.attendance.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: {
        employeeId,
        workDate,
        checkInTime: now,
        checkInWifiId: wifi.id,
        checkInLocation: dto.location ?? null,
        status,
        note: dto.note ?? null,
      },
      update: {
        checkInTime: now,
        checkInWifiId: wifi.id,
        checkInLocation: dto.location ?? null,
        status,
        note: dto.note ?? undefined,
      },
    });
  }

  /** The employee performs a check-out (must be on office WiFi). */
  async checkOut(user: AuthUser, dto: CheckOutDto): Promise<Attendance> {
    const employeeId = this.requireEmployee(user);

    const wifi = await this.wifiService.verifyOrThrow(dto.ssid, dto.bssid);

    const workDate = toDateOnly(getWorkDate());
    const record = await this.prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
    });
    if (!record || !record.checkInTime) {
      throw new BadRequestException('common.errors.not_checked_in');
    }
    if (record.checkOutTime) {
      throw new ConflictException('common.errors.already_checked_out');
    }

    const now = new Date();
    return this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOutTime: now,
        checkOutWifiId: wifi.id,
        checkOutLocation: dto.location ?? null,
        workHours: diffHours(record.checkInTime, now),
      },
    });
  }

  /** Today's attendance for the logged-in employee (or null). */
  today(user: AuthUser): Promise<Attendance | null> {
    const employeeId = this.requireEmployee(user);
    return this.prisma.attendance.findUnique({
      where: {
        employeeId_workDate: { employeeId, workDate: toDateOnly(getWorkDate()) },
      },
      include: { checkInWifi: true, checkOutWifi: true },
    });
  }

  /** History for the logged-in employee. */
  history(
    user: AuthUser,
    query: QueryAttendanceDto,
  ): Promise<PaginatedResult<Attendance>> {
    const employeeId = this.requireEmployee(user);
    // Force the filter to the caller's own employee id (ignore any spoofed value).
    query.employeeId = employeeId;
    return this.list(query, false);
  }

  /** Admin/manager listing across employees. */
  async list(
    query: QueryAttendanceDto,
    withEmployee = true,
  ): Promise<PaginatedResult<Attendance>> {
    const where: Prisma.AttendanceWhereInput = {};
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.dateFrom || query.dateTo) {
      const workDate: Prisma.DateTimeFilter = {};
      if (query.dateFrom) workDate.gte = toDateOnly(query.dateFrom);
      if (query.dateTo) workDate.lte = toDateOnly(query.dateTo);
      where.workDate = workDate;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        include: withEmployee ? { employee: true } : undefined,
        orderBy: [{ workDate: 'desc' }, { checkInTime: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  // ---- helpers ----
  private requireEmployee(user: AuthUser): string {
    if (!user.employeeId) {
      throw new ForbiddenException('common.errors.employee_not_found');
    }
    return user.employeeId;
  }

  private resolveStatus(
    now: Date,
    workDate: string,
    schedule: WorkSchedule | null,
  ): AttendanceStatus {
    if (!schedule) {
      return AttendanceStatus.present;
    }
    const threshold = timeOnDateToInstant(workDate, schedule.startTime);
    const graceMs = (schedule.lateAfterMinutes ?? 0) * 60_000;
    return now.getTime() > threshold.getTime() + graceMs
      ? AttendanceStatus.late
      : AttendanceStatus.present;
  }
}
