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

  async send(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<void> {
    if (tokens.length === 0) return;
    const app = this.init();
    if (!app) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getMessaging } = require('firebase-admin/messaging');
      await getMessaging(app).sendEachForMulticast({
        tokens,
        notification: { title, body },
        data,
      });
    } catch (e) {
      this.logger.warn(`FCM send failed: ${(e as Error).message}`);
    }
  }
}
