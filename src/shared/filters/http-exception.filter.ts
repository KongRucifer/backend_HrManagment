import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { I18nService } from 'nestjs-i18n';

/**
 * Normalizes every error into a consistent JSON shape the frontends can rely on:
 * { success: false, statusCode, message, path, timestamp }
 *
 * Registered via APP_FILTER so I18nService is injected and error keys such as
 * "common.errors.wifi_invalid" are translated to the request language.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = 'Internal server error';
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      message =
        typeof res === 'string'
          ? res
          : (res as any).message || exception.message;
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    message = this.translate(message, this.resolveLang(request));

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  /** Picks the request language from ?lang / x-lang / Accept-Language. */
  private resolveLang(request: Request): string {
    const q = (request.query?.lang as string) || undefined;
    const header =
      (request.headers['x-lang'] as string) ||
      (request.headers['accept-language'] as string) ||
      undefined;
    return (q || header || 'lo').split(',')[0].trim();
  }

  /** Translates i18n keys (e.g. "common.errors.wifi_invalid"); others pass through. */
  private translate(
    message: string | string[],
    lang: string,
  ): string | string[] {
    const tr = (m: string): string =>
      m.startsWith('common.')
        ? (this.i18n.translate(m, { lang }) as unknown as string)
        : m;
    return Array.isArray(message) ? message.map(tr) : tr(message);
  }
}
