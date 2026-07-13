import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toDateOnly } from '../../shared/utils/datetime.util';
import { NotificationsService } from '../notifications/notifications.service';
import { ApproverLookupService } from './approver-lookup.service';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly lookup: ApproverLookupService,
  ) {}

  // ============ LEAVE ============
  async createLeave(
    employeeId: string,
    dto: { reason: string; startDate: string; endDate: string },
  ) {
    const chain = await this.prisma.leaveApprover.findMany({
      orderBy: { stepOrder: 'asc' },
    });
    if (chain.length === 0) {
      throw new BadRequestException('common.errors.no_leave_chain');
    }
    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
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
    // Last step approved -> fully approved.
    await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: RequestStatus.approved },
    });
    await this.notifyRequester(request.employeeId, 'leave_approved', requestId);
    return { status: 'approved' };
  }

  /** The requester's own leave requests, with step progress. */
  async myLeave(employeeId: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { employeeId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.decorateLeave(rows);
  }

  /** Requests where this user is an approver (with an `actionable` flag). */
  async leaveToApprove(userId: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { steps: { some: { approverUserId: userId } } },
      include: { steps: { orderBy: { stepOrder: 'asc' } }, employee: true },
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
    const [approverInfo, emps] = await Promise.all([
      this.lookup.resolve(approverIds),
      this.prisma.employee.findMany({ where: { id: { in: empIds } } }),
    ]);
    const empMap = new Map(emps.map((e) => [e.id, e]));
    return rows.map((r) => {
      const e = empMap.get(r.employeeId);
      return {
        id: r.id,
        type: 'leave',
        reason: r.reason,
        startDate: r.startDate,
        endDate: r.endDate,
        status: r.status,
        currentStep: r.currentStep,
        createdAt: r.createdAt,
        requester: e
          ? {
              name: `${e.firstName} ${e.lastName}`.trim(),
              phone: e.phone,
              email: e.email,
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

  // ============ SICK ============
  async createSick(
    employeeId: string,
    dto: { sickTypeId: string; approverUserId: string; reason: string },
  ) {
    const inPool = await this.prisma.sickApprover.findUnique({
      where: { approverUserId: dto.approverUserId },
    });
    if (!inPool) throw new BadRequestException('common.errors.invalid_approver');

    const request = await this.prisma.sickRequest.create({
      data: {
        employeeId,
        sickTypeId: dto.sickTypeId,
        approverUserId: dto.approverUserId,
        reason: dto.reason,
      },
    });
    await this.notifyApprover(dto.approverUserId, 'sick', request.id, employeeId);
    return request;
  }

  async decideSick(
    userId: string,
    requestId: string,
    approve: boolean,
    comment?: string,
  ) {
    const request = await this.prisma.sickRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('common.errors.not_found');
    if (request.approverUserId !== userId) {
      throw new ForbiddenException('common.errors.not_your_turn');
    }
    if (request.status !== RequestStatus.pending) {
      throw new BadRequestException('common.errors.already_decided');
    }
    await this.prisma.sickRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? RequestStatus.approved : RequestStatus.rejected,
        comment,
        decidedAt: new Date(),
      },
    });
    await this.notifyRequester(
      request.employeeId,
      approve ? 'sick_approved' : 'sick_rejected',
      requestId,
    );
    return { status: approve ? 'approved' : 'rejected' };
  }

  async mySick(employeeId: string) {
    const rows = await this.prisma.sickRequest.findMany({
      where: { employeeId },
      include: { sickType: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.decorateSick(rows);
  }

  async sickToApprove(userId: string) {
    const rows = await this.prisma.sickRequest.findMany({
      where: { approverUserId: userId },
      include: { sickType: true, employee: true },
      orderBy: { createdAt: 'desc' },
    });
    const decorated = await this.decorateSick(rows);
    return decorated.map((r: any) => ({
      ...r,
      actionable: r.status === 'pending',
    }));
  }

  private async decorateSick(rows: any[]) {
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const approverIds = [...new Set(rows.map((r) => r.approverUserId))];
    const [emps, approverInfo] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: empIds } } }),
      this.lookup.resolve(approverIds),
    ]);
    const empMap = new Map(emps.map((e) => [e.id, e]));
    return rows.map((r) => {
      const e = empMap.get(r.employeeId);
      return {
        id: r.id,
        type: 'sick',
        sickType: r.sickType?.name ?? null,
        reason: r.reason,
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
              email: e.email,
            }
          : null,
      };
    });
  }

  // ============ helpers ============
  private async userIdOfEmployee(employeeId: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({
      where: { employeeId },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  private async notifyApprover(
    approverUserId: string,
    kind: 'leave' | 'sick',
    refId: string,
    requesterEmployeeId: string,
  ) {
    const requester = await this.lookup
      .resolve([await this.userIdOfEmployee(requesterEmployeeId).then((v) => v ?? '')])
      .catch(() => null);
    const name =
      (requester && [...requester.values()][0]?.name) || 'ພະນັກງານ';
    await this.notifications.notify(approverUserId, {
      type: kind === 'leave' ? 'leave_request' : 'sick_request',
      title: kind === 'leave' ? 'ຄຳຮ້ອງລາພັກໃໝ່' : 'ຄຳຮ້ອງເຈັບປວດໃໝ່',
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
      sick_approved: 'ຄຳຮ້ອງເຈັບປວດ ຖືກອານຸມັດແລ້ວ',
      sick_rejected: 'ຄຳຮ້ອງເຈັບປວດ ຖືກປະຕິເສດ',
    };
    await this.notifications.notify(userId, {
      type,
      title: 'ຜົນການອານຸມັດ',
      body: map[type] ?? 'ອັບເດດສະຖານະຄຳຮ້ອງ',
      refId,
    });
  }
}
