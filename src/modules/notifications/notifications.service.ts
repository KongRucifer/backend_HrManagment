import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../shared/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FcmService } from './fcm.service';
import { NotificationsGateway } from './notifications.gateway';
import { QueryNotificationDto } from './dto/query-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /** Creates an in-app notification and (if configured) sends a push. */
  async notify(
    userId: string,
    input: { type: string; title: string; body: string; refId?: string },
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        refId: input.refId ?? null,
      },
    });

    // Before the FCM round-trip: an app that is open should light its badge up
    // immediately rather than wait on Google's servers.
    await this.gateway.pushNotification(userId, {
      type: input.type,
      title: input.title,
      body: input.body,
      refId: input.refId ?? null,
    });

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    const dead = await this.fcm.send(
      tokens.map((t) => t.token),
      input.title,
      input.body,
      { type: input.type, refId: input.refId ?? '' },
    );
    // Purge tokens FCM reported as unregistered / invalid so they don't pile up.
    if (dead.length) {
      await this.prisma.deviceToken.deleteMany({
        where: { token: { in: dead } },
      });
    }
  }

  /**
   * Paged list, newest first, optionally narrowed to read / unread.
   * The @@index([userId, isRead]) on the model covers both shapes.
   */
  async list(
    userId: string,
    query: QueryNotificationDto,
  ): Promise<PaginatedResult<Prisma.NotificationGetPayload<object>>> {
    const where: Prisma.NotificationWhereInput = { userId };
    if (query.isRead !== undefined) where.isRead = query.isRead;
    if (query.dateFrom || query.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.dateFrom) createdAt.gte = new Date(`${query.dateFrom}T00:00:00`);
      // Inclusive end: everything up to 23:59:59.999 of dateTo.
      if (query.dateTo) createdAt.lte = new Date(`${query.dateTo}T23:59:59.999`);
      where.createdAt = createdAt;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    // Reading on the phone should drop the badge on the user's other devices too.
    await this.gateway.emitUnread(userId);
    return { success: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    await this.gateway.emitUnread(userId);
    return { success: true };
  }

  async registerToken(userId: string, token: string, platform?: string) {
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform: platform ?? null },
      update: { userId, platform: platform ?? null },
    });
    return { success: true };
  }

  async removeToken(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
    return { success: true };
  }
}
