import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  APP_TIMEZONE,
  getWorkDate,
  toDateOnly,
} from '../../shared/utils/datetime.util';
import { NotificationsService } from '../notifications/notifications.service';
import { EmployeesService } from './employees.service';

const TYPE = 'birthday_today'; // refId = the employee's id

/**
 * Sends every admin a notification on each employee's birthday, so it rings and
 * shows in the same real-time bell as everything else.
 *
 * (The BirthdayBell widget still shows the UPCOMING few days as a heads-up; this
 * is the day-of alert.)
 *
 * Idempotent: a birthday matches on exactly one calendar day, and a per-day
 * guard skips any admin already notified for this employee today — so a cron
 * restart can't double-send.
 */
@Injectable()
export class BirthdayReminderService {
  private readonly logger = new Logger(BirthdayReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('10 0 * * *', { timeZone: APP_TIMEZONE })
  async runDaily(): Promise<void> {
    const res = await this.checkBirthdays();
    this.logger.log(
      `Birthday reminders: ${res.birthdays} today, ${res.notified} notifications sent`,
    );
  }

  /** Runnable on demand (admin endpoint) as well as from the nightly cron. */
  async checkBirthdays(): Promise<{ birthdays: number; notified: number }> {
    // Reuse the existing computation — `today` is exactly today's birthdays.
    const { today } = await this.employees.birthdays(0);
    if (today.length === 0) return { birthdays: 0, notified: 0 };

    const admins = await this.prisma.user.findMany({
      where: { role: Role.admin, isActive: true, deletedAt: null },
      select: { id: true },
    });
    const startOfToday = toDateOnly(getWorkDate());

    let notified = 0;
    for (const b of today) {
      const name = `${b.firstName} ${b.lastName}`.trim();
      const title = 'ວັນເກີດ 🎂';
      const body = `ມື້ນີ້ວັນເກີດ ${name}`;

      for (const admin of admins) {
        const already = await this.prisma.notification.count({
          where: {
            userId: admin.id,
            type: TYPE,
            refId: b.id,
            createdAt: { gte: startOfToday },
          },
        });
        if (already > 0) continue;

        await this.notifications.notify(admin.id, {
          type: TYPE,
          title,
          body,
          refId: b.id,
        });
        notified++;
      }
    }

    return { birthdays: today.length, notified };
  }
}
