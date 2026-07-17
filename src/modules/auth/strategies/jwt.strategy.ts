import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../../shared/decorators/current-user.decorator';
import { authCookieName } from '../../../shared/utils/app-cookie.util';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string | null;
  role: string;
  employeeId: string | null;
}

/**
 * Reads the JWT from the httpOnly cookie (browser) or Bearer header (mobile/API).
 * The cookie name is per-app (`<base>_admin` / `<base>_employee`) so the admin
 * and employee web apps keep separate sessions on the same host; the plain base
 * name is tried as a fallback for older cookies / clients without `X-App`.
 */
const cookieExtractor = (req: Request): string | null => {
  const base = process.env.COOKIE_NAME || 'access_token';
  const name = authCookieName(req, base);
  return req?.cookies?.[name] ?? req?.cookies?.[base] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    return {
      userId: payload.sub,
      email: payload.email,
      username: payload.username,
      role: payload.role,
      employeeId: payload.employeeId ?? null,
    };
  }
}
