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
  timeToMinutes,
  toDateOnly,
} from '../../../shared/utils/datetime.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeesService } from '../../employees/employees.service';
import { GpsService } from '../gps/gps.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { GrantRemoteWorkDto } from './dto/remote-work.dto';
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
    private readonly gpsService: GpsService,
    private readonly employeesService: EmployeesService,
  ) {}

  /**
   * Verifies the caller is physically at the office via GPS coordinates, which
   * both the web and mobile apps now send (WiFi checking has been retired).
   *
   * Exception: an admin can grant a "work from home" day for this employee, in
   * which case the geofence is skipped entirely and the check-in is accepted
   * from anywhere. Throws when no WFH grant applies and either the coordinates
   * are missing or fall outside every office radius.
   */
  private async verifyPresence(
    employeeId: string,
    dto: { lat?: number; lng?: number },
  ): Promise<void> {
    // WFH bypass first: if today is a granted remote-work day, accept without
    // any location check (the employee is deliberately not at the office).
    const remote = await this.prisma.remoteWorkDay.findUnique({
      where: {
        employeeId_workDate: {
          employeeId,
          workDate: toDateOnly(getWorkDate()),
        },
      },
    });
    if (remote) return;

    if (dto.lat != null && dto.lng != null) {
      await this.gpsService.verifyOrThrow(dto.lat, dto.lng);
      return;
    }
    // No GPS fix supplied and no WFH grant — nothing to verify against.
    throw new ForbiddenException('common.errors.location_required');
  }

  /** The employee performs a check-in (must be within an office geofence). */
  async checkIn(user: AuthUser, dto: CheckInDto): Promise<Attendance> {
    const employeeId = this.requireEmployee(user);

    // 1) Presence gate — GPS verified server-side (or skipped for a WFH day).
    await this.verifyPresence(employeeId, dto);

    // 2) One record per employee per day. A row may already exist because an
    //    approved leave/emergency was materialized onto this day — that is NOT
    //    a duplicate check-in, so only a real checkInTime blocks.
    const workDateStr = getWorkDate();
    const workDate = toDateOnly(workDateStr);
    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
      include: {
        emergencyRequest: { select: { startTime: true, endTime: true } },
      },
    });
    if (existing && existing.checkInTime) {
      throw new ConflictException('common.errors.already_checked_in');
    }

    const now = new Date();
    const employee = await this.employeesService.findOne(employeeId);
    // An approved morning emergency pushes back the on-time deadline.
    const expectedStart = this.expectedStartFor(
      employee.workSchedule,
      existing?.emergencyRequest ?? null,
    );
    const status = this.resolveStatus(
      now,
      workDateStr,
      employee.workSchedule,
      expectedStart,
    );

    // The upsert is keyed on (employeeId, workDate), so a leave/emergency day
    // is UPDATED in place — never duplicated. leaveRequestId/emergencyRequestId
    // are deliberately left untouched: the day stays linked to its request even
    // though the person turned up, and the badge keeps showing.
    return this.prisma.attendance.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: {
        employeeId,
        workDate,
        checkInTime: now,
        checkInLocation: dto.location ?? null,
        status,
        note: dto.note ?? null,
      },
      update: {
        checkInTime: now,
        checkInLocation: dto.location ?? null,
        status,
        note: dto.note ?? undefined,
      },
    });
  }

  /** The employee performs a check-out (GPS, or skipped for a WFH day). */
  async checkOut(user: AuthUser, dto: CheckOutDto): Promise<Attendance> {
    const employeeId = this.requireEmployee(user);

    await this.verifyPresence(employeeId, dto);

    const workDateStr = getWorkDate();
    const workDate = toDateOnly(workDateStr);
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
    // Leaving before the schedule's end is recorded on every day that has a
    // check-out — including leave/emergency days, where the person came in
    // anyway. Kept separate from `status` so "late AND left early" is not lost.
    const employee = await this.employeesService.findOne(employeeId);
    const schedule = employee.workSchedule;
    const leftEarly = schedule
      ? now.getTime() <
        timeOnDateToInstant(workDateStr, schedule.endTime).getTime()
      : false;

    return this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOutTime: now,
        checkOutLocation: dto.location ?? null,
        workHours: diffHours(record.checkInTime, now),
        leftEarly,
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
    if (query.leftEarly !== undefined) where.leftEarly = query.leftEarly;
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
        leftEarly: true,
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
      leftEarlyDays: count((r) => r.leftEarly),
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

  // ---- Work-from-home (GPS bypass) grants ----
  /**
   * Grants the selected employees a WFH day (default: today) so they can check
   * in/out from anywhere. Idempotent: createMany + skipDuplicates on the
   * (employeeId, workDate) unique key, so re-granting is a no-op.
   */
  async grantRemoteWork(dto: GrantRemoteWorkDto, actorId?: string) {
    const date = toDateOnly(dto.date ?? getWorkDate());
    const res = await this.prisma.remoteWorkDay.createMany({
      data: dto.employeeIds.map((employeeId) => ({
        employeeId,
        workDate: date,
        createdById: actorId ?? null,
      })),
      skipDuplicates: true,
    });
    return { granted: res.count, date: date.toISOString().slice(0, 10) };
  }

  /** Lists the employees granted a WFH day on `date` (default: today). */
  async listRemoteWork(date?: string) {
    const workDate = toDateOnly(date ?? getWorkDate());
    const rows = await this.prisma.remoteWorkDay.findMany({
      where: { workDate },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      date: workDate.toISOString().slice(0, 10),
      items: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employee: r.employee,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * All WFH grants grouped by date (newest date first) so the admin sees every
   * day they have scheduled, each with its list of employees.
   */
  async listAllRemoteWork() {
    const rows = await this.prisma.remoteWorkDay.findMany({
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    });

    // Group into { date, items } buckets, preserving the desc date order.
    const byDate = new Map<
      string,
      { date: string; items: typeof rows }
    >();
    for (const r of rows) {
      const key = r.workDate.toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, { date: key, items: [] });
      byDate.get(key)!.items.push(r);
    }

    return {
      dates: [...byDate.values()].map((d) => ({
        date: d.date,
        items: d.items.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          employee: r.employee,
          createdAt: r.createdAt,
        })),
      })),
    };
  }

  /** Revokes a single WFH grant. No-op (idempotent) if it was not granted. */
  async revokeRemoteWork(employeeId: string, date?: string) {
    const workDate = toDateOnly(date ?? getWorkDate());
    await this.prisma.remoteWorkDay.deleteMany({
      where: { employeeId, workDate },
    });
    return { revoked: true };
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

  /**
   * on_time / late only — checking in at all means you are NOT absent, however
   * late you are. (`absent` is written solely by the nightly job, for people
   * who never came.)
   *
   * [expectedStart] overrides the schedule's start time: an approved emergency
   * that covers the morning excuses the employee until its endTime, so a
   * 09:00–13:30 emergency makes 13:30 (+ grace) the on-time deadline.
   */
  private resolveStatus(
    now: Date,
    workDate: string,
    schedule: WorkSchedule | null,
    expectedStart?: string | null,
  ): AttendanceStatus {
    if (!schedule) {
      return AttendanceStatus.on_time;
    }
    const start = expectedStart ?? schedule.startTime;
    const threshold = timeOnDateToInstant(workDate, start);
    const graceMs = (schedule.lateAfterMinutes ?? 0) * 60_000;
    return now.getTime() > threshold.getTime() + graceMs
      ? AttendanceStatus.late
      : AttendanceStatus.on_time;
  }

  /**
   * The time the employee is due in on this day.
   *
   * Normally the schedule's start. But an APPROVED emergency whose window
   * covers that start (e.g. 09:00–13:30 against a 09:00 schedule) excuses the
   * morning, so they are due back when it ends. An afternoon emergency
   * (14:00–16:00) does not move the morning deadline.
   *
   * Whole-day emergencies and leave carry no time window and so do not shift
   * anything — the normal start applies if the person turns up anyway.
   */
  private expectedStartFor(
    schedule: WorkSchedule | null,
    emergency: { startTime: string | null; endTime: string | null } | null,
  ): string | null {
    if (!schedule || !emergency?.startTime || !emergency?.endTime) return null;
    const coversStart =
      timeToMinutes(emergency.startTime) <= timeToMinutes(schedule.startTime);
    return coversStart ? emergency.endTime : null;
  }
}
