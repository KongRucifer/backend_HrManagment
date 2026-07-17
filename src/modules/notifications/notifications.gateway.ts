import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

/** Payload pushed to a client when one of its notifications arrives. */
export interface PushedNotification {
  type: string;
  title: string;
  body: string;
  refId?: string | null;
}

/** Every socket of one user shares a room, so all their devices stay in sync. */
const room = (userId: string) => `user:${userId}`;

/**
 * Real-time notification channel (socket.io).
 *
 * FCM already handles pushes while the app is backgrounded/killed; this covers
 * what FCM can't: keeping the OPEN app's bell badge truthful. Crucially the
 * server emits the current unread count on CONNECT, so a client that missed
 * events while suspended re-syncs the moment it reconnects — which is what
 * fixes the stale badge after the app returns to the foreground.
 *
 * The global `api` prefix does not apply to websockets: the URL is
 *   ws://<host>:<port>/ws
 */
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    // The handshake is authenticated by JWT, so reflecting the caller's origin
    // is safe here — an attacker's page still cannot forge a valid token.
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The mobile app holds a Bearer token, the admin SPA only an httpOnly cookie
   * it cannot read from JS — so accept the token from either place.
   */
  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as
      | { token?: string; app?: string }
      | undefined;
    if (auth?.token) return auth.token;

    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);

    const cookie = client.handshake.headers.cookie;
    if (cookie) {
      const base = this.config.get<string>('cookie.name') || 'access_token';
      // Prefer the per-app cookie the client tells us to use, then fall back to
      // the base name (mobile / legacy) — the browser sends all of them.
      const names =
        auth?.app === 'admin'
          ? [`${base}_admin`, base]
          : auth?.app === 'employee'
            ? [`${base}_employee`, base]
            : [base, `${base}_employee`, `${base}_admin`];
      const parts = cookie.split(';').map((c) => c.trim());
      for (const name of names) {
        const hit = parts.find((c) => c.startsWith(`${name}=`));
        if (hit) return decodeURIComponent(hit.slice(name.length + 1));
      }
    }
    return null;
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (!payload?.sub) throw new Error('no sub');
      userId = payload.sub;
    } catch {
      // Expired or forged token — say nothing, just drop the socket.
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    await client.join(room(userId));

    // Re-sync immediately: this connect may be a reconnect after the app was
    // suspended, during which the badge went stale.
    await this.emitUnread(userId);
    this.logger.debug(`socket ${client.id} joined ${room(userId)}`);
  }

  /** Pushes the user's current unread count to every device they have open. */
  async emitUnread(userId: string): Promise<void> {
    // The gateway is optional infrastructure — a socket.io failure must never
    // bubble into the HTTP request that triggered it.
    try {
      const count = await this.prisma.notification.count({
        where: { userId, isRead: false },
      });
      this.server?.to(room(userId)).emit('unread', { count });
    } catch (err) {
      this.logger.warn(`emitUnread failed for ${userId}: ${err}`);
    }
  }

  /** Announces a new notification, then the count that goes with it. */
  async pushNotification(
    userId: string,
    payload: PushedNotification,
  ): Promise<void> {
    try {
      this.server?.to(room(userId)).emit('notification', payload);
    } catch (err) {
      this.logger.warn(`pushNotification failed for ${userId}: ${err}`);
    }
    await this.emitUnread(userId);
  }
}
