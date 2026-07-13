import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ApproverInfo {
  userId: string;
  employeeId: string | null;
  name: string;
  phone: string | null;
  email: string;
}

/**
 * Resolves "approver" identities. An approver is an auth user; their display
 * name/phone come from the linked employee (public schema, cross-schema lookup).
 */
@Injectable()
export class ApproverLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /** Searchable list of users who can be picked as approvers. */
  async candidates(search?: string): Promise<ApproverInfo[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, employeeId: { not: null } },
    });
    const list = await this.attach(users);
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        (c.phone ?? '').includes(search) ||
        c.email.toLowerCase().includes(s),
    );
  }

  /** Resolve display info for a set of approver user ids. */
  async resolve(userIds: string[]): Promise<Map<string, ApproverInfo>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
    });
    const list = await this.attach(users);
    return new Map(list.map((c) => [c.userId, c]));
  }

  async info(userId: string): Promise<ApproverInfo | null> {
    return (await this.resolve([userId])).get(userId) ?? null;
  }

  private async attach(
    users: { id: string; email: string; employeeId: string | null }[],
  ): Promise<ApproverInfo[]> {
    const empIds = users
      .map((u) => u.employeeId)
      .filter((v): v is string => !!v);
    const emps = empIds.length
      ? await this.prisma.employee.findMany({ where: { id: { in: empIds } } })
      : [];
    const empMap = new Map(emps.map((e) => [e.id, e]));
    return users.map((u) => {
      const e = u.employeeId ? empMap.get(u.employeeId) : null;
      return {
        userId: u.id,
        employeeId: u.employeeId,
        name: e ? `${e.firstName} ${e.lastName}`.trim() : u.email,
        phone: e?.phone ?? null,
        email: u.email,
      };
    });
  }
}
