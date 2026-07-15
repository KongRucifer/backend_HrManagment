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
        // Snapshot the chain so later edits don't affect this request.
        steps: {
          create: chain.map((c) => ({
            approverUserId: c.approverUserId,
            stepOrder: c.stepOrder,
          })),
        },
      },
    });
    // Notify the first approver only.
    await this.notifyApprover(chain[0].approverUserId, 'leave', request.id, employeeId);
    return request;
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
    const next = request.steps.find((s) => s.stepOrder === request.currentStep + 1);
    if (next) {
      await this.prisma.leaveRequest.update({
        where: { id: requestId },
        data: { currentStep: request.currentStep + 1 },
      });
      await this.notifyApprover(next.approverUserId, 'leave', requestId, request.employeeId);
      return { status: 'pending', nextStep: next.stepOrder };
    }
    // Last step approved -> fully approved. The transaction guarantees an
    // approved request can never exist without its attendance days.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.leaveRequest.update({
          where: { id: requestId },
          data: { status: RequestStatus.approved },
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

  /** The requester's own leave requests, with step progress. */
  async myLeave(employeeId: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { employeeId },
      include: { steps: { orderBy: { stepOrder: 'asc' } }, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.decorateLeave(rows);
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
        leaveType: r.leaveType?.name ?? null,
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
      approverUserId: string;
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

    const inPool = await this.prisma.emergencyApprover.findUnique({
      where: { approverUserId: dto.approverUserId },
    });
    if (!inPool) throw new BadRequestException('common.errors.invalid_approver');

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
        emergencyType: r.emergencyType?.name ?? null,
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
