import { Injectable, Logger } from '@nestjs/common';

/**
 * Firebase Cloud Messaging sender. `firebase-admin` and credentials are loaded
 * LAZILY: if the package isn't installed or no service account is configured,
 * push is silently skipped (in-app notifications still work).
 *
 * To enable push, set FIREBASE_SERVICE_ACCOUNT to EITHER:
 *   - the raw service-account JSON (inline, e.g. '{"type":"service_account",...}')
 *   - or a path to the serviceAccount.json file (absolute, or relative to cwd)
 * (or leave it empty and rely on GOOGLE_APPLICATION_CREDENTIALS).
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private app: any = null;
  private tried = false;

  private init(): any {
    if (this.tried) return this.app;
    this.tried = true;
    try {
      // firebase-admin v14 modular API.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initializeApp, getApps, getApp, cert, applicationDefault } =
        require('firebase-admin/app');
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
      let credential: any;
      if (raw && raw.startsWith('{')) {
        // Inline JSON service account.
        credential = cert(JSON.parse(raw));
      } else if (raw) {
        // File path (absolute, or relative to the working directory).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodePath = require('path');
        const abs = nodePath.isAbsolute(raw)
          ? raw
          : nodePath.resolve(process.cwd(), raw);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        credential = cert(require(abs));
      } else {
        credential = applicationDefault();
      }
      this.app =
        getApps().length > 0 ? getApp() : initializeApp({ credential });
      this.logger.log('Firebase push enabled');
    } catch (e) {
      this.logger.warn(
        `Firebase push disabled (in-app only): ${(e as Error).message}`,
      );
      this.app = null;
    }
    return this.app;
  }

  /**
   * Sends a push to every token and returns the tokens FCM reports as DEAD
   * (unregistered / invalid) so the caller can purge them from the DB.
   * Returns [] when push is disabled, there are no tokens, or the call fails.
   */
  async send(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<string[]> {
    if (tokens.length === 0) return [];
    const app = this.init();
    if (!app) return [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getMessaging } = require('firebase-admin/messaging');
      const res = await getMessaging(app).sendEachForMulticast({
        tokens,
        notification: { title, body },
        data,
        // Android: route to our channel (which carries the custom sound). The
        // channel's own sound wins, but naming it here keeps intent explicit.
        android: {
          notification: {
            channelId: 'hr_notifications',
            sound: 'notification_sound',
          },
        },
        // iOS: play the bundled custom sound for background / terminated pushes
        // (foreground is handled in-app by flutter_local_notifications). Must be
        // the filename WITH extension of the file bundled in the Runner app.
        apns: {
          payload: {
            aps: {
              sound: 'notification_sound.wav',
            },
          },
        },
      });

      // responses[i] lines up with tokens[i]. Collect the ones FCM says are dead.
      const dead: string[] = [];
      res.responses.forEach((r: any, i: number) => {
        if (r.success) return;
        const code: string | undefined = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          dead.push(tokens[i]);
        }
      });
      return dead;
    } catch (e) {
      this.logger.warn(`FCM send failed: ${(e as Error).message}`);
      return [];
    }
  }
}
