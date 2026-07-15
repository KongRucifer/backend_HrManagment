import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  Attendance,
  AttendanceStatus,
  EmployeeStatus,
  Prisma,
  WorkSchedule,
} from '@prisma/client';
import { AuthUser } from '../../../shared/decorators/current-user.decorator';
import {
  APP_TIMEZONE,
  diffHours,
  expandWorkDays,
  getWorkDate,
  monthRange,
  timeOnDateToInstant,
  toDateOnly,
} from '../../../shared/utils/datetime.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeesService } from '../../employees/employees.service';
import { WifiService } from '../wifi/wifi.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { SummaryAttendanceDto } from './dto/summary-attendance.dto';

/**
 * Joins the approved-request relations so each row can carry a compact label.
 * Narrow `select` on purpose: keeps the payload small AND avoids leaking the
 * request `reason` (free text) into the admin list.
 */
const requestLabelInclude = {
  leaveRequest: { select: { leaveType: { select: { name: true } } } },
  emergencyRequest: { select: { emergencyType: { select: { name: true } } } },
} satisfies Prisma.AttendanceInclude;

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

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
  async today(user: AuthUser) {
    const employeeId = this.requireEmployee(user);
    const row = await this.prisma.attendance.findUnique({
      where: {
        employeeId_workDate: { employeeId, workDate: toDateOnly(getWorkDate()) },
      },
      include: {
        checkInWifi: true,
        checkOutWifi: true,
        ...requestLabelInclude,
      },
    });
    return row ? this.decorate(row) : null;
  }

  /** History for the logged-in employee. */
  history(user: AuthUser, query: QueryAttendanceDto) {
    const employeeId = this.requireEmployee(user);
    // Force the filter to the caller's own employee id (ignore any spoofed value).
    query.employeeId = employeeId;
    return this.list(query, false);
  }

  /** Admin/manager listing across employees. */
  async list(query: QueryAttendanceDto, withEmployee = true) {
    const where: Prisma.AttendanceWhereInput = {};
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    // Filter by FK, not status: a partial-day emergency keeps status=on_time.
    if (query.kind === 'leave') where.leaveRequestId = { not: null };
    if (query.kind === 'emergency') where.emergencyRequestId = { not: null };
    if (query.search) {
      // Filter across the related employee's name / code.
      where.employee = {
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { employeeCode: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }
    if (query.dateFrom || query.dateTo) {
      const workDate: Prisma.DateTimeFilter = {};
      if (query.dateFrom) workDate.gte = toDateOnly(query.dateFrom);
      if (query.dateTo) workDate.lte = toDateOnly(query.dateTo);
      where.workDate = workDate;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        include: { employee: withEmployee, ...requestLabelInclude },
        orderBy: [{ workDate: 'desc' }, { checkInTime: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      items: items.map((a) => this.decorate(a)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * Day counts for the logged-in employee over a date range (defaults to the
   * current Vientiane month). Counts DAYS, not requests.
   *
   * leaveDays / emergencyDays are counted by FK, NOT by status: a partial-day
   * emergency where the employee checked in keeps status=on_time and only
   * carries the FK, so counting by status would miss it entirely.
   *
   * The counters OVERLAP by design (a partial emergency day is both on_time
   * and emergency) — callers must never sum them.
   */
  async summary(user: AuthUser, query: SummaryAttendanceDto) {
    const employeeId = this.requireEmployee(user);
    const fallback = monthRange();
    const from = query.dateFrom ?? fallback.from;
    const to = query.dateTo ?? fallback.to;

    const rows = await this.prisma.attendance.findMany({
      where: {
        employeeId,
        workDate: { gte: toDateOnly(from), lte: toDateOnly(to) },
      },
      select: {
        status: true,
        leaveRequestId: true,
        emergencyRequestId: true,
        checkInTime: true,
      },
    });

    const count = (p: (r: (typeof rows)[number]) => boolean) =>
      rows.filter(p).length;

    return {
      dateFrom: from,
      dateTo: to,
      onTimeDays: count((r) => r.status === AttendanceStatus.on_time),
      lateDays: count((r) => r.status === AttendanceStatus.late),
      absentDays: count((r) => r.status === AttendanceStatus.absent),
      leaveDays: count((r) => r.leaveRequestId !== null),
      emergencyDays: count((r) => r.emergencyRequestId !== null),
      workedDays: count((r) => r.checkInTime !== null),
      totalDays: rows.length,
    };
  }

  /**
   * Marks every active employee with no attendance row on `date` as absent.
   * A row already existing (a real check-in, or a materialized leave/emergency
   * day) means the employee is accounted for -> skipped.
   *
   * Idempotent: createMany + skipDuplicates on the (employeeId, workDate)
   * unique key. It is create-only, so it can never overwrite an existing row.
   */
  async markAbsentForDate(date: Date): Promise<{ marked: number; skipped: number }> {
    // Weekends are not work days — nobody is absent on a Saturday.
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) return { marked: 0, skipped: 0 };

    const [employees, existing] = await Promise.all([
      this.prisma.employee.findMany({
        // Registering IS the start of work, so existing in this table is the
        // only condition — no hire-date floor. The nightly job marks YESTERDAY,
        // and someone who registers today simply did not exist when it ran, so
        // it can never mark a day before they joined. (Only a manual backfill
        // over dates predating a registration could, which is admin-driven.)
        where: { status: EmployeeStatus.active },
        select: { id: true },
      }),
      this.prisma.attendance.findMany({
        where: { workDate: date },
        select: { employeeId: true },
      }),
    ]);

    const accounted = new Set(existing.map((a) => a.employeeId));
    const missing = employees.filter((e) => !accounted.has(e.id));

    const res = await this.prisma.attendance.createMany({
      data: missing.map((e) => ({
        employeeId: e.id,
        workDate: date,
        status: AttendanceStatus.absent,
      })),
      skipDuplicates: true,
    });
    return { marked: res.count, skipped: employees.length - res.count };
  }

  /**
   * Runs at 00:05 Vientiane and marks the PREVIOUS day. Yesterday is over, so
   * every check-in/out has settled — there is no way to mark someone absent
   * who was going to show up later.
   */
  @Cron('5 0 * * *', { timeZone: APP_TIMEZONE })
  async markYesterdayAbsent(): Promise<void> {
    const today = toDateOnly(getWorkDate());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const res = await this.markAbsentForDate(yesterday);
    this.logger.log(
      `Absent job for ${yesterday.toISOString().slice(0, 10)}: ` +
        `marked ${res.marked}, skipped ${res.skipped}`,
    );
  }

  /** Admin backfill / manual re-run over a date range (weekends skipped). */
  async markAbsentRange(dateFrom: string, dateTo: string) {
    let marked = 0;
    let skipped = 0;
    for (const day of expandWorkDays(toDateOnly(dateFrom), toDateOnly(dateTo))) {
      const res = await this.markAbsentForDate(day);
      marked += res.marked;
      skipped += res.skipped;
    }
    return { dateFrom, dateTo, marked, skipped };
  }

  // ---- helpers ----
  /** Flattens the request relations into a compact label pair for the UI. */
  private decorate<T extends Record<string, any>>(a: T) {
    const { leaveRequest, emergencyRequest, ...rest } = a;
    return {
      ...rest,
      requestKind: a.leaveRequestId
        ? ('leave' as const)
        : a.emergencyRequestId
          ? ('emergency' as const)
          : null,
      requestTypeName:
        leaveRequest?.leaveType?.name ??
        emergencyRequest?.emergencyType?.name ??
        null,
    };
  }

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
      return AttendanceStatus.on_time;
    }
    const threshold = timeOnDateToInstant(workDate, schedule.startTime);
    const graceMs = (schedule.lateAfterMinutes ?? 0) * 60_000;
    return now.getTime() > threshold.getTime() + graceMs
      ? AttendanceStatus.late
      : AttendanceStatus.on_time;
  }
}
