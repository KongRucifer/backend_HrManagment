import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmployeeStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  APP_TIMEZONE,
  getWorkDate,
  toDateOnly,
} from '../../shared/utils/datetime.util';
import { NotificationsService } from '../notifications/notifications.service';

/** Notification types this producer emits (refId = the employee's id). */
const TYPE_SOON = 'contract_expiry_soon'; // fires 30 days out
const TYPE_TODAY = 'contract_expiry_today'; // fires on the end date

/** How many days ahead the early reminder fires. */
const LEAD_DAYS = 30;

/**
 * Notifies every admin when an employment contract is about to end — 30 days
 * before, and again on the day itself.
 *
 * Idempotent: it keys off the CALENDAR condition (contract ends exactly today,
 * or exactly in 30 days), so each milestone lands on one specific day. A guard
 * additionally skips any admin who was already notified for this employee+type
 * today, so a same-day restart of the cron can't double-send. A contract
 * renewed to a future date simply re-qualifies later, unblocked.
 */
@Injectable()
export class ContractReminderService {
  private readonly logger = new Logger(ContractReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('15 0 * * *', { timeZone: APP_TIMEZONE })
  async runDaily(): Promise<void> {
    const res = await this.checkContracts();
    this.logger.log(
      `Contract reminders: ${res.soon} ending soon, ${res.today} ending today, ` +
        `${res.notified} notifications sent`,
    );
  }

  /** Runnable on demand (admin endpoint) as well as from the nightly cron. */
  async checkContracts(): Promise<{
    soon: number;
    today: number;
    notified: number;
  }> {
    const todayStr = getWorkDate();
    const today = toDateOnly(todayStr);
    const inLead = new Date(today.getTime() + LEAD_DAYS * 86_400_000);

    const [employees, admins] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          deletedAt: null,
          status: EmployeeStatus.active,
          OR: [{ contractEndDate: today }, { contractEndDate: inLead }],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          contractEndDate: true,
        },
      }),
      this.prisma.user.findMany({
        where: { role: Role.admin, isActive: true, deletedAt: null },
        select: { id: true },
      }),
    ]);

    let soon = 0;
    let todayCount = 0;
    let notified = 0;

    for (const emp of employees) {
      const end = emp.contractEndDate as Date;
      const isToday = end.getTime() === today.getTime();
      const type = isToday ? TYPE_TODAY : TYPE_SOON;
      if (isToday) todayCount++;
      else soon++;

      const endStr = end.toISOString().slice(0, 10);
      const name = `${emp.firstName} ${emp.lastName}`.trim();
      const title = isToday ? 'ສັນຍາໝົດມື້ນີ້' : 'ສັນຍາໃກ້ໝົດ';
      const body = isToday
        ? `ສັນຍາຂອງ ${name} (${emp.employeeCode}) ໝົດ ວັນທີ ${endStr}`
        : `ສັນຍາຂອງ ${name} (${emp.employeeCode}) ຈະໝົດ ວັນທີ ${endStr} (ອີກ ${LEAD_DAYS} ວັນ)`;

      for (const admin of admins) {
        // Skip if this admin already got this exact reminder today.
        const already = await this.prisma.notification.count({
          where: {
            userId: admin.id,
            type,
            refId: emp.id,
            createdAt: { gte: today },
          },
        });
        if (already > 0) continue;

        await this.notifications.notify(admin.id, {
          type,
          title,
          body,
          refId: emp.id,
        });
        notified++;
      }
    }

    return { soon, today: todayCount, notified };
  }
}
