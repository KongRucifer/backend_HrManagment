import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApproverLookupService } from './approver-lookup.service';

@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookup: ApproverLookupService,
  ) {}

  // ---------------- Leave approval chain ----------------
  async getChain() {
    const rows = await this.prisma.leaveApprover.findMany({
      orderBy: { stepOrder: 'asc' },
    });
    const info = await this.lookup.resolve(rows.map((r) => r.approverUserId));
    return rows.map((r) => ({
      id: r.id,
      stepOrder: r.stepOrder,
      approverUserId: r.approverUserId,
      approver: info.get(r.approverUserId) ?? null,
    }));
  }

  /** Append approvers to the end of the chain (skips ones already in it). */
  async addChainApprovers(userIds: string[]) {
    const existing = await this.prisma.leaveApprover.findMany();
    const have = new Set(existing.map((e) => e.approverUserId));
    let next =
      existing.reduce((m, e) => Math.max(m, e.stepOrder), 0) + 1;
    for (const uid of userIds) {
      if (have.has(uid)) continue;
      await this.prisma.leaveApprover.create({
        data: { approverUserId: uid, stepOrder: next++ },
      });
      have.add(uid);
    }
    return this.getChain();
  }

  /** Rewrite the whole chain in the given order (used for reorder/edit). */
  async reorderChain(approverUserIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.leaveApprover.deleteMany(),
      ...approverUserIds.map((uid, i) =>
        this.prisma.leaveApprover.create({
          data: { approverUserId: uid, stepOrder: i + 1 },
        }),
      ),
    ]);
    return this.getChain();
  }

  async removeChainApprover(id: string) {
    await this.prisma.leaveApprover.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('common.errors.not_found');
    });
    // Resequence remaining steps.
    const rows = await this.prisma.leaveApprover.findMany({
      orderBy: { stepOrder: 'asc' },
    });
    await this.prisma.$transaction(
      rows.map((r, i) =>
        this.prisma.leaveApprover.update({
          where: { id: r.id },
          data: { stepOrder: i + 1 },
        }),
      ),
    );
    return this.getChain();
  }

  // ---------------- Leave types ----------------
  listLeaveTypes() {
    return this.prisma.leaveType.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Active types only (for the employee's request form). */
  listActiveLeaveTypes() {
    return this.prisma.leaveType.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  createLeaveType(name: string, laoName?: string | null) {
    return this.prisma.leaveType.create({
      data: { name, laoName: laoName || null },
    });
  }

  updateLeaveType(
    id: string,
    data: { name?: string; laoName?: string | null; isActive?: boolean },
  ) {
    return this.prisma.leaveType.update({
      where: { id },
      // An empty box means "no Lao name", not "leave unchanged" — store null so
      // the display falls back to the English name.
      data: {
        ...data,
        ...(data.laoName !== undefined && { laoName: data.laoName || null }),
      },
    });
  }

  async deleteLeaveType(id: string) {
    await this.prisma.leaveType.delete({ where: { id } });
    return { success: true };
  }

  // ---------------- Emergency (ສຸກເສີນ) types ----------------
  listEmergencyTypes() {
    return this.prisma.emergencyType.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Active types only (for the employee's request form). */
  listActiveEmergencyTypes() {
    return this.prisma.emergencyType.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  createEmergencyType(name: string, laoName?: string | null) {
    return this.prisma.emergencyType.create({
      data: { name, laoName: laoName || null },
    });
  }

  updateEmergencyType(
    id: string,
    data: { name?: string; laoName?: string | null; isActive?: boolean },
  ) {
    return this.prisma.emergencyType.update({
      where: { id },
      data: {
        ...data,
        ...(data.laoName !== undefined && { laoName: data.laoName || null }),
      },
    });
  }

  async deleteEmergencyType(id: string) {
    await this.prisma.emergencyType.delete({ where: { id } });
    return { success: true };
  }

  // ---------------- Emergency approver pool ----------------
  async getEmergencyPool() {
    const rows = await this.prisma.emergencyApprover.findMany({
      orderBy: { createdAt: 'asc' },
    });
    const info = await this.lookup.resolve(rows.map((r) => r.approverUserId));
    return rows.map((r) => ({
      id: r.id,
      approverUserId: r.approverUserId,
      approver: info.get(r.approverUserId) ?? null,
    }));
  }

  async addEmergencyApprovers(userIds: string[]) {
    for (const uid of userIds) {
      await this.prisma.emergencyApprover
        .create({ data: { approverUserId: uid } })
        .catch(() => undefined); // ignore duplicates (unique)
    }
    return this.getEmergencyPool();
  }

  async removeEmergencyApprover(id: string) {
    await this.prisma.emergencyApprover.delete({ where: { id } });
    return this.getEmergencyPool();
  }
}
