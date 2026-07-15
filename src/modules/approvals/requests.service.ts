import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Prisma, RequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  countDays,
  countWorkHours,
  expandWorkDays,
  timeToMinutes,
  toDateOnly,
} from '../../shared/utils/datetime.util';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { ApproverLookupService } from './approver-lookup.service';
import { QueryMyRequestsDto } from './dto/query-my-requests.dto';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly lookup: ApproverLookupService,
    private readonly users: UsersService,
  ) {}

  // ============ LEAVE ============
  async createLeave(
    employeeId: string,
    dto: {
      leaveTypeId: string;
      reason: string;
      startDate: string;
      endDate: string;
    },
  ) {
    // The end date may equal the start date, but never precede it.
    if (toDateOnly(dto.endDate) < toDateOnly(dto.startDate)) {
      throw new BadRequestException('common.errors.end_before_start');
    }
    const chain = await this.prisma.leaveApprover.findMany({
      orderBy: { stepOrder: 'asc' },
    });
    if (chain.length === 0) {
      throw new BadRequestException('common.errors.no_leave_chain');
    }
    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: dto.leaveTypeId,
        reason: dto.reason,
        startDate: toDateOnly(dto.startDate),
        endDate: toDateOnly(dto.endDate),
        currentStep: 1,
        // Snapshot the chain so later edits don't affect this request. The
        // requester's own steps are kept rather than dropped: settleLeave
        // auto-approves them, which leaves an honest audit trail.
        steps: {
          create: chain.map((c) => ({
            approverUserId: c.approverUserId,
            stepOrder: c.stepOrder,
          })),
        },
      },
    });
    // Walks to the first step someone else must decide, notifying them — or
    // approves outright when the chain holds nobody but the requester.
    await this.settleLeave(request.id);
    return this.prisma.leaveRequest.findUnique({ where: { id: request.id } });
  }

  /**
   * Moves a leave request forward from its current step.
   *
   * A step whose approver IS the requester is approved automatically: nobody
   * reviews their own leave, and waiting on them would deadlock the chain (the
   * request form hides them from the displayed chain for the same reason).
   * Consecutive such steps are possible, so this loops instead of skipping one.
   *
   * Shared by createLeave and decideLeave so the rule cannot drift between
   * "the chain starts on me" and "the chain reaches me later".
   */
  private async settleLeave(
    requestId: string,
  ): Promise<{ status: string; nextStep?: number }> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!request) throw new NotFoundException('common.errors.not_found');

    const requesterUserId = await this.userIdOfEmployee(request.employeeId);
    let current = request.currentStep;

    for (;;) {
      const step = request.steps.find((s) => s.stepOrder === current);
      if (!step) break; // chain exhausted -> fully approved below

      if (step.approverUserId !== requesterUserId) {
        // A real reviewer: park here and hand it to them.
        if (current !== request.currentStep) {
          await this.prisma.leaveRequest.update({
            where: { id: requestId },
            data: { currentStep: current },
          });
        }
        await this.notifyApprover(
          step.approverUserId,
          'leave',
          requestId,
          request.employeeId,
        );
        return { status: 'pending', nextStep: current };
      }

      await this.prisma.leaveRequestStep.update({
        where: { id: step.id },
        data: {
          status: RequestStatus.approved,
          auto: true,
          decidedAt: new Date(),
        },
      });
      current += 1;
    }

    // Every remaining step was the requester's own -> nothing left to decide.
    // The transaction guarantees an approved request can never exist without
    // its attendance days.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.leaveRequest.update({
          where: { id: requestId },
          data: {
            status: RequestStatus.approved,
            // Park on the last real step; currentStep is only meaningful while
            // pending, and pointing past the chain would read as a bug.
            currentStep: Math.max(1, current - 1),
          },
        });
        await this.materialize(tx, {
          employeeId: request.employeeId,
          startDate: request.startDate,
          endDate: request.endDate,
          status: AttendanceStatus.leave,
          fk: { leaveRequestId: requestId },
        });
      },
      // A month-long leave is ~22 sequential upserts; the 5s default is tight.
      { timeout: 15_000 },
    );
    await this.notifyRequester(request.employeeId, 'leave_approved', requestId);
    return { status: 'approved' };
  }

  async decideLeave(
    userId: string,
    requestId: string,
    approve: boolean,
    comment?: string,
  ) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!request) throw new NotFoundException('common.errors.not_found');
    if (request.status !== RequestStatus.pending) {
      throw new BadRequestException('common.errors.already_decided');
    }
    const step = request.steps.find((s) => s.stepOrder === request.currentStep);
    if (!step || step.approverUserId !== userId) {
      throw new ForbiddenException('common.errors.not_your_turn');
    }

    if (!approve) {
      await this.prisma.$transaction([
        this.prisma.leaveRequestStep.update({
          where: { id: step.id },
          data: { status: RequestStatus.rejected, comment, decidedAt: new Date() },
        }),
        this.prisma.leaveRequest.update({
          where: { id: requestId },
          data: { status: RequestStatus.rejected },
        }),
      ]);
      await this.notifyRequester(request.employeeId, 'leave_rejected', requestId);
      return { status: 'rejected' };
    }

    await this.prisma.leaveRequestStep.update({
      where: { id: step.id },
      data: { status: RequestStatus.approved, comment, decidedAt: new Date() },
    });
    await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { currentStep: request.currentStep + 1 },
    });
    // From here the next step may be the requester's own (auto-approved) or the
    // chain may be finished — settleLeave owns both cases.
    return this.settleLeave(requestId);
  }

  /** The requester's own leave requests, with step progress. */
  async myLeave(employeeId: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { employeeId },
      include: { steps: { orderBy: { stepOrder: 'asc' } }, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.decorateLeave(rows);
  }

  /**
   * The employee's own leave + emergency requests as ONE paged list.
   *
   * A merge of two tables can't be paginated by the DB, so: take (skip+limit)
   * from each side (both already sorted desc), merge, sort, then slice the
   * window. That is exact — the true page can only contain rows within the
   * first (skip+limit) of either side — while keeping memory bounded, unlike
   * loading every request the employee ever made.
   */
  async myRequests(employeeId: string, query: QueryMyRequestsDto) {
    const where = query.status
      ? { employeeId, status: query.status }
      : { employeeId };
    const window = query.skip + query.limit;

    const [leaveRows, emgRows, leaveTotal, emgTotal] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        include: { steps: { orderBy: { stepOrder: 'asc' } }, leaveType: true },
        orderBy: { createdAt: 'desc' },
        take: window,
      }),
      this.prisma.emergencyRequest.findMany({
        where,
        include: { emergencyType: true },
        orderBy: { createdAt: 'desc' },
        take: window,
      }),
      this.prisma.leaveRequest.count({ where }),
      this.prisma.emergencyRequest.count({ where }),
    ]);

    const [leave, emergency] = await Promise.all([
      this.decorateLeave(leaveRows),
      this.decorateEmergency(emgRows),
    ]);
    const merged = [...leave, ...emergency].sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = leaveTotal + emgTotal;
    return {
      items: merged.slice(query.skip, query.skip + query.limit),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * One leave request by id — used to deep-link from a notification, where all
   * the client has is `refId`. Readable by the requester or any of its
   * approvers; `actionable` mirrors the inbox so the decision UI can reuse it.
   */
  async findLeaveById(userId: string, employeeId: string | null, id: string) {
    const row = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: 'asc' } }, leaveType: true },
    });
    if (!row) throw new NotFoundException('common.errors.not_found');

    const myStep = row.steps.find((s) => s.approverUserId === userId);
    const isRequester = employeeId !== null && employeeId === row.employeeId;
    if (!isRequester && !myStep) {
      throw new ForbiddenException('common.errors.not_your_turn');
    }
    const [decorated] = await this.decorateLeave([row]);
    return {
      ...decorated,
      actionable:
        row.status === RequestStatus.pending &&
        myStep?.stepOrder === row.currentStep &&
        myStep?.status === RequestStatus.pending,
      myStepOrder: myStep?.stepOrder ?? null,
    };
  }

  /** One emergency request by id (see findLeaveById). */
  async findEmergencyById(
    userId: string,
    employeeId: string | null,
    id: string,
  ) {
    const row = await this.prisma.emergencyRequest.findUnique({
      where: { id },
      include: { emergencyType: true },
    });
    if (!row) throw new NotFoundException('common.errors.not_found');

    const isApprover = row.approverUserId === userId;
    const isRequester = employeeId !== null && employeeId === row.employeeId;
    if (!isRequester && !isApprover) {
      throw new ForbiddenException('common.errors.not_your_turn');
    }
    const [decorated] = await this.decorateEmergency([row]);
    return {
      ...decorated,
      actionable: isApprover && row.status === RequestStatus.pending,
    };
  }

  /**
   * Whether this user should see the approvals ("Manage Leave") area at all.
   *
   * Live chain/pool membership alone is NOT enough: each leave request
   * snapshots the chain at creation, so someone removed from the chain today
   * can still hold a pending step on an in-flight request. Hiding the area
   * from them would strand that request with nobody able to decide it — hence
   * the pending-work checks below.
   */
  async approverStatus(userId: string): Promise<{ isApprover: boolean }> {
    const [inChain, inPool, pendingLeave, pendingEmergency] = await Promise.all([
      this.prisma.leaveApprover.count({ where: { approverUserId: userId } }),
      this.prisma.emergencyApprover.count({ where: { approverUserId: userId } }),
      this.prisma.leaveRequest.count({
        where: {
          status: RequestStatus.pending,
          steps: {
            some: { approverUserId: userId, status: RequestStatus.pending },
          },
        },
      }),
      this.prisma.emergencyRequest.count({
        where: { approverUserId: userId, status: RequestStatus.pending },
      }),
    ]);
    return {
      isApprover:
        inChain > 0 || inPool > 0 || pendingLeave > 0 || pendingEmergency > 0,
    };
  }

  /** Requests where this user is an approver (with an `actionable` flag). */
  async leaveToApprove(userId: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { steps: { some: { approverUserId: userId } } },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        leaveType: true,
        employee: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const decorated = await this.decorateLeave(rows);
    return decorated.map((r: any, i: number) => {
      const myStep = rows[i].steps.find((s) => s.approverUserId === userId);
      return {
        ...r,
        myStepOrder: myStep?.stepOrder,
        myStepStatus: myStep?.status,
        actionable:
          rows[i].status === 'pending' &&
          myStep?.stepOrder === rows[i].currentStep &&
          myStep?.status === 'pending',
      };
    });
  }

  private async decorateLeave(rows: any[]) {
    const approverIds = [
      ...new Set(rows.flatMap((r) => r.steps.map((s: any) => s.approverUserId))),
    ];
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    // Email lives on the login account now, so resolve it per employee.
    const [approverInfo, emps, accounts] = await Promise.all([
      this.lookup.resolve(approverIds),
      this.prisma.employee.findMany({ where: { id: { in: empIds } } }),
      this.users.accountsOfEmployees(empIds),
    ]);
    const empMap = new Map(emps.map((e) => [e.id, e]));
    return rows.map((r) => {
      const e = empMap.get(r.employeeId);
      return {
        id: r.id,
        type: 'leave',
        // Both names, resolved on the client: picking here from the request's
        // x-lang header would freeze the label until a refetch, so switching
        // language in the app would leave the old one on screen.
        leaveType: r.leaveType
          ? { name: r.leaveType.name, laoName: r.leaveType.laoName }
          : null,
        reason: r.reason,
        startDate: r.startDate,
        endDate: r.endDate,
        // Inclusive day count (same day = 1) for the summary line.
        days: countDays(r.startDate, r.endDate),
        status: r.status,
        currentStep: r.currentStep,
        createdAt: r.createdAt,
        requester: e
          ? {
              name: `${e.firstName} ${e.lastName}`.trim(),
              phone: e.phone,
              email: accounts.get(e.id)?.email ?? null,
            }
          : null,
        steps: r.steps.map((s: any) => ({
          stepOrder: s.stepOrder,
          status: s.status,
          decidedAt: s.decidedAt,
          // Lets the timeline say "approved automatically" instead of implying
          // this person sat and reviewed their own request.
          auto: s.auto,
          approver: approverInfo.get(s.approverUserId) ?? null,
        })),
      };
    });
  }

  // ============ EMERGENCY (ສຸກເສີນ) ============
  async createEmergency(
    employeeId: string,
    dto: {
      emergencyTypeId: string;
      /** Absent only when the pool holds nobody but the requester. */
      approverUserId?: string | null;
      reason: string;
      startDate: string;
      endDate: string;
      startTime?: string | null;
      endTime?: string | null;
    },
  ) {
    const start = toDateOnly(dto.startDate);
    const end = toDateOnly(dto.endDate);
    // 1) The end date may equal the start date, but never precede it.
    if (end < start) {
      throw new BadRequestException('common.errors.end_before_start');
    }

    // 2) Times are optional, but all-or-nothing.
    const startTime = dto.startTime || null;
    const endTime = dto.endTime || null;
    if (!!startTime !== !!endTime) {
      throw new BadRequestException('common.errors.time_pair_required');
    }

    if (startTime && endTime) {
      // 3) Within a single day the end time must be strictly after the start.
      if (
        countDays(start, end) === 1 &&
        timeToMinutes(endTime) <= timeToMinutes(startTime)
      ) {
        throw new BadRequestException('common.errors.end_time_after_start');
      }
      // 4) The window must overlap the employee's working hours.
      const schedule = await this.scheduleOf(employeeId);
      const hours = countWorkHours(
        startTime,
        endTime,
        countDays(start, end),
        schedule,
      );
      if (hours <= 0) {
        throw new BadRequestException('common.errors.outside_work_hours');
      }
    }

    // 5) Nobody approves their own emergency request, so the requester never
    // counts as an available approver — the form hides them for the same reason.
    const requesterUserId = await this.userIdOfEmployee(employeeId);
    const pool = await this.prisma.emergencyApprover.findMany();
    const others = pool.filter((p) => p.approverUserId !== requesterUserId);

    if (!dto.approverUserId) {
      // Only legitimate when the pool holds nobody but the requester: there is
      // no one who could ever decide it, so it stands approved on creation.
      if (others.length > 0) {
        throw new BadRequestException('common.errors.invalid_approver');
      }
      const request = await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.emergencyRequest.create({
            data: {
              employeeId,
              emergencyTypeId: dto.emergencyTypeId,
              // Self, so the row keeps an accurate "who owns this decision".
              approverUserId: requesterUserId!,
              reason: dto.reason,
              startDate: start,
              endDate: end,
              startTime,
              endTime,
              status: RequestStatus.approved,
              auto: true,
              decidedAt: new Date(),
            },
          });
          await this.materialize(tx, {
            employeeId,
            startDate: start,
            endDate: end,
            status: AttendanceStatus.emergency,
            fk: { emergencyRequestId: created.id },
          });
          return created;
        },
        { timeout: 15_000 },
      );
      return request;
    }

    if (dto.approverUserId === requesterUserId) {
      throw new BadRequestException('common.errors.invalid_approver');
    }
    if (!others.some((p) => p.approverUserId === dto.approverUserId)) {
      throw new BadRequestException('common.errors.invalid_approver');
    }

    const request = await this.prisma.emergencyRequest.create({
      data: {
        employeeId,
        emergencyTypeId: dto.emergencyTypeId,
        approverUserId: dto.approverUserId,
        reason: dto.reason,
        startDate: start,
        endDate: end,
        startTime,
        endTime,
      },
    });
    await this.notifyApprover(
      dto.approverUserId,
      'emergency',
      request.id,
      employeeId,
    );
    return request;
  }

  async decideEmergency(
    userId: string,
    requestId: string,
    approve: boolean,
    comment?: string,
  ) {
    const request = await this.prisma.emergencyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('common.errors.not_found');
    if (request.approverUserId !== userId) {
      throw new ForbiddenException('common.errors.not_your_turn');
    }
    if (request.status !== RequestStatus.pending) {
      throw new BadRequestException('common.errors.already_decided');
    }
    // One-shot decision: materialize the attendance days only on approval.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.emergencyRequest.update({
          where: { id: requestId },
          data: {
            status: approve ? RequestStatus.approved : RequestStatus.rejected,
            comment,
            decidedAt: new Date(),
          },
        });
        if (approve) {
          await this.materialize(tx, {
            employeeId: request.employeeId,
            startDate: request.startDate,
            endDate: request.endDate,
            status: AttendanceStatus.emergency,
            fk: { emergencyRequestId: requestId },
          });
        }
      },
      { timeout: 15_000 },
    );
    await this.notifyRequester(
      request.employeeId,
      approve ? 'emergency_approved' : 'emergency_rejected',
      requestId,
    );
    return { status: approve ? 'approved' : 'rejected' };
  }

  async myEmergency(employeeId: string) {
    const rows = await this.prisma.emergencyRequest.findMany({
      where: { employeeId },
      include: { emergencyType: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.decorateEmergency(rows);
  }

  async emergencyToApprove(userId: string) {
    const rows = await this.prisma.emergencyRequest.findMany({
      where: { approverUserId: userId },
      include: { emergencyType: true, employee: true },
      orderBy: { createdAt: 'desc' },
    });
    const decorated = await this.decorateEmergency(rows);
    return decorated.map((r: any) => ({
      ...r,
      actionable: r.status === 'pending',
    }));
  }

  private async decorateEmergency(rows: any[]) {
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const approverIds = [...new Set(rows.map((r) => r.approverUserId))];
    const [emps, approverInfo, activeSchedule, accounts] = await Promise.all([
      // workSchedule is needed to count hours against the working window.
      this.prisma.employee.findMany({
        where: { id: { in: empIds } },
        include: { workSchedule: true },
      }),
      this.lookup.resolve(approverIds),
      this.prisma.workSchedule.findFirst({
        where: { isActive: true },
        select: { startTime: true, endTime: true },
      }),
      // Email lives on the login account now.
      this.users.accountsOfEmployees(empIds),
    ]);
    const empMap = new Map(emps.map((e) => [e.id, e]));
    return rows.map((r) => {
      const e = empMap.get(r.employeeId);
      const days = countDays(r.startDate, r.endDate);
      const schedule = e?.workSchedule ?? activeSchedule;
      return {
        id: r.id,
        type: 'emergency',
        // Both names — see decorateLeave.
        emergencyType: r.emergencyType
          ? { name: r.emergencyType.name, laoName: r.emergencyType.laoName }
          : null,
        reason: r.reason,
        startDate: r.startDate,
        endDate: r.endDate,
        startTime: r.startTime,
        endTime: r.endTime,
        // Summary: inclusive days, plus working hours when a time window is set.
        days,
        hours:
          r.startTime && r.endTime
            ? countWorkHours(r.startTime, r.endTime, days, schedule)
            : null,
        status: r.status,
        comment: r.comment,
        decidedAt: r.decidedAt,
        // Approved on creation because the pool held nobody but the requester.
        auto: r.auto,
        createdAt: r.createdAt,
        // The single chosen approver (so the requester knows who to wait for).
        approver: approverInfo.get(r.approverUserId) ?? null,
        requester: e
          ? {
              name: `${e.firstName} ${e.lastName}`.trim(),
              phone: e.phone,
              email: accounts.get(e.id)?.email ?? null,
            }
          : null,
      };
    });
  }

  // ============ helpers ============
  /**
   * Writes one attendance row per WORK day (Sat/Sun skipped) covered by an
   * approved request. Three cases, decided by whether a real check-in exists:
   *
   *   1. no row yet (full-day leave, never showed up)
   *        -> CREATE with status leave/emergency, no check-in times, FK set.
   *   2. row exists but checkInTime IS NULL (a synthetic "absent" row from the
   *      nightly job, now excused by a back-dated request)
   *        -> set the FK **and** correct status to leave/emergency.
   *   3. row exists WITH a real checkInTime (partial-day emergency: the person
   *      worked, then left)
   *        -> set the FK ONLY. Never overwrite status/times — a 14:00 emergency
   *           does not unmake an 08:55 on-time arrival, and status is the only
   *           copy of that signal (the Dashboard tiles read it).
   *
   * The UI label comes from the FK, not from status, so case 3 still shows the
   * badge. Idempotent: re-running writes the identical FK.
   *
   * NOT reversed on cancel — nothing can un-approve a request today (decide*
   * hard-blocks on status !== pending, and there is no DELETE route). When
   * cancellation lands, the inverse is:
   *   deleteMany({ where: { leaveRequestId: id, checkInTime: null } })  // synthetic
   *   updateMany({ where: { leaveRequestId: id }, data: { leaveRequestId: null } })
   */
  private async materialize(
    tx: Prisma.TransactionClient,
    args: {
      employeeId: string;
      startDate: Date;
      endDate: Date;
      status: AttendanceStatus;
      fk: { leaveRequestId: string } | { emergencyRequestId: string },
    },
  ): Promise<void> {
    for (const workDate of expandWorkDays(args.startDate, args.endDate)) {
      const existing = await tx.attendance.findUnique({
        where: {
          employeeId_workDate: { employeeId: args.employeeId, workDate },
        },
        select: { id: true, checkInTime: true },
      });
      if (!existing) {
        await tx.attendance.create({
          data: {
            employeeId: args.employeeId,
            workDate,
            status: args.status,
            ...args.fk,
          },
        });
      } else {
        await tx.attendance.update({
          where: { id: existing.id },
          data: {
            ...args.fk,
            // Only a row with no real check-in may have its status replaced.
            ...(existing.checkInTime === null ? { status: args.status } : {}),
          },
        });
      }
    }
  }

  /**
   * The work schedule used to count hours: the employee's own assigned one,
   * falling back to the currently active schedule.
   */
  private async scheduleOf(
    employeeId: string,
  ): Promise<{ startTime: string; endTime: string } | null> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { workSchedule: { select: { startTime: true, endTime: true } } },
    });
    if (emp?.workSchedule) return emp.workSchedule;
    return this.prisma.workSchedule.findFirst({
      where: { isActive: true },
      select: { startTime: true, endTime: true },
    });
  }

  private async userIdOfEmployee(employeeId: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({
      where: { employeeId },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  private async notifyApprover(
    approverUserId: string,
    kind: 'leave' | 'emergency',
    refId: string,
    requesterEmployeeId: string,
  ) {
    const requester = await this.lookup
      .resolve([await this.userIdOfEmployee(requesterEmployeeId).then((v) => v ?? '')])
      .catch(() => null);
    const name =
      (requester && [...requester.values()][0]?.name) || 'ພະນັກງານ';
    await this.notifications.notify(approverUserId, {
      type: kind === 'leave' ? 'leave_request' : 'emergency_request',
      title: kind === 'leave' ? 'ຄຳຮ້ອງລາພັກໃໝ່' : 'ຄຳຮ້ອງສຸກເສີນໃໝ່',
      body: `${name} ສົ່ງຄຳຮ້ອງ ລໍຖ້າການອານຸມັດ`,
      refId,
    });
  }

  private async notifyRequester(
    employeeId: string,
    type: string,
    refId: string,
  ) {
    const userId = await this.userIdOfEmployee(employeeId);
    if (!userId) return;
    const map: Record<string, string> = {
      leave_approved: 'ໃບລາພັກຂອງທ່ານ ຖືກອານຸມັດແລ້ວ',
      leave_rejected: 'ໃບລາພັກຂອງທ່ານ ຖືກປະຕິເສດ',
      emergency_approved: 'ຄຳຮ້ອງສຸກເສີນ ຖືກອານຸມັດແລ້ວ',
      emergency_rejected: 'ຄຳຮ້ອງສຸກເສີນ ຖືກປະຕິເສດ',
    };
    await this.notifications.notify(userId, {
      type,
      title: 'ຜົນການອານຸມັດ',
      body: map[type] ?? 'ອັບເດດສະຖານະຄຳຮ້ອງ',
      refId,
    });
  }
}
