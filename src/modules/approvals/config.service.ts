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

  // ---------------- Sick types ----------------
  listSickTypes() {
    return this.prisma.sickType.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Active types only (for the employee's request form). */
  listActiveSickTypes() {
    return this.prisma.sickType.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  createSickType(name: string) {
    return this.prisma.sickType.create({ data: { name } });
  }

  updateSickType(id: string, data: { name?: string; isActive?: boolean }) {
    return this.prisma.sickType.update({ where: { id }, data });
  }

  async deleteSickType(id: string) {
    await this.prisma.sickType.delete({ where: { id } });
    return { success: true };
  }

  // ---------------- Sick approver pool ----------------
  async getSickPool() {
    const rows = await this.prisma.sickApprover.findMany({
      orderBy: { createdAt: 'asc' },
    });
    const info = await this.lookup.resolve(rows.map((r) => r.approverUserId));
    return rows.map((r) => ({
      id: r.id,
      approverUserId: r.approverUserId,
      approver: info.get(r.approverUserId) ?? null,
    }));
  }

  async addSickApprovers(userIds: string[]) {
    for (const uid of userIds) {
      await this.prisma.sickApprover
        .create({ data: { approverUserId: uid } })
        .catch(() => undefined); // ignore duplicates (unique)
    }
    return this.getSickPool();
  }

  async removeSickApprover(id: string) {
    await this.prisma.sickApprover.delete({ where: { id } });
    return this.getSickPool();
  }
}
