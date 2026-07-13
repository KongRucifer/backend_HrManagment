import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../../shared/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string | null;
  role: string;
  employeeId: string | null;
}

/** Reads the JWT from the httpOnly cookie (browser) or Bearer header (mobile/API). */
const cookieExtractor = (req: Request): string | null => {
  const name = process.env.COOKIE_NAME || 'access_token';
  return req?.cookies?.[name] ?? null;
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
