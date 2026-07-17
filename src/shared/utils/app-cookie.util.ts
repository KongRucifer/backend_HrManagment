import { Request } from 'express';

export type ClientApp = 'admin' | 'employee';

/**
 * Which web app a request came from, read from the `X-App` header that each
 * frontend sends on every call. Unknown / missing (mobile & API clients that use
 * the Bearer header) -> undefined.
 */
export function clientAppOf(req: Request): ClientApp | undefined {
  const raw = (req?.headers?.['x-app'] as string | undefined)?.toLowerCase();
  if (raw === 'admin' || raw === 'employee') return raw;
  return undefined;
}

/**
 * The auth-cookie name for a request. Each web app stores its JWT under its OWN
 * cookie name (`<base>_admin` / `<base>_employee`) so the two sessions don't
 * overwrite each other on localhost — cookies there are host-scoped, not
 * port-scoped, so a single shared name would let one app's login leak into the
 * other. Requests without `X-App` fall back to the plain base name.
 */
export function authCookieName(req: Request, baseName: string): string {
  const app = clientAppOf(req);
  if (app === 'admin') return `${baseName}_admin`;
  if (app === 'employee') return `${baseName}_employee`;
  return baseName;
}
