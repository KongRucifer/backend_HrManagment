import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { toDateOnly } from '../../shared/utils/datetime.util';
import { EmployeesService } from '../employees/employees.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly employeesService: EmployeesService,
    private readonly mail: MailService,
  ) {}

  /**
   * Step 1 of the email-verified password change: generate a 6-digit OTP,
   * store it hashed (10-min expiry, previous codes invalidated) and email it.
   * Returns the address it was sent to (for the UI to display).
   */
  async requestPasswordOtp(userId: string): Promise<{ email: string }> {
    const user = await this.usersService.findOne(userId);
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 minutes
    await this.prisma.$transaction([
      this.prisma.passwordOtp.deleteMany({ where: { userId } }),
      this.prisma.passwordOtp.create({ data: { userId, codeHash, expiresAt } }),
    ]);
    await this.mail.sendPasswordOtp(user.email, code);
    return { email: user.email };
  }

  /**
   * The caller's current profile, read fresh from the DB.
   * (The JWT payload goes stale as soon as the email/username is changed, so it
   * must not be echoed back here.) Shape matches the JWT-derived AuthUser.
   */
  async me(userId: string) {
    const u = await this.usersService.findOne(userId);
    return {
      userId: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      employeeId: u.employeeId,
    };
  }

  /** Changes the logged-in user's own username (must stay unique). */
  async updateUsername(userId: string, username: string) {
    const taken = await this.prisma.user.findUnique({ where: { username } });
    if (taken && taken.id !== userId) {
      throw new ConflictException('common.errors.username_taken');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { username, updatedAt: new Date(), updatedById: userId },
    });
    return { success: true, username };
  }

  /**
   * Step 1 of an email change: send a code to the NEW address (proves the user
   * owns it). The pending address is stored with the code.
   */
  async requestEmailOtp(userId: string, newEmail: string) {
    if (await this.usersService.isEmailTaken(newEmail, userId)) {
      throw new ConflictException('common.errors.email_taken');
    }
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60_000); // 10 minutes
    await this.prisma.$transaction([
      this.prisma.emailOtp.deleteMany({ where: { userId } }),
      this.prisma.emailOtp.create({
        data: { userId, newEmail, codeHash, expiresAt },
      }),
    ]);
    // Sent to the NEW address on purpose — that's what we're verifying.
    await this.mail.sendEmailChangeOtp(newEmail, code);
    return { email: newEmail };
  }

  /** Step 2: verify the code and switch the account to the new address. */
  async confirmEmailOtp(userId: string, code: string) {
    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('common.errors.otp_not_found');
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('common.errors.otp_expired');
    }
    if (otp.attempts >= 5) {
      throw new BadRequestException('common.errors.otp_too_many_attempts');
    }
    const valid = await bcrypt.compare(code, otp.codeHash);
    if (!valid) {
      await this.prisma.emailOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('common.errors.otp_invalid');
    }
    // Re-check: the address may have been taken while the code was in flight.
    if (await this.usersService.isEmailTaken(otp.newEmail, userId)) {
      throw new ConflictException('common.errors.email_taken');
    }
    await this.prisma.$transaction([
      this.prisma.emailOtp.update({
        where: { id: otp.id },
        data: { consumed: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: otp.newEmail,
          updatedAt: new Date(),
          updatedById: userId,
        },
      }),
    ]);
    return { success: true, email: otp.newEmail };
  }

  /**
   * Step 2: verify the OTP and, if valid, set the new password.
   * Enforces expiry and a max of 5 wrong attempts per code.
   */
  async confirmPasswordOtp(
    userId: string,
    code: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('common.errors.password_too_short');
    }
    const otp = await this.prisma.passwordOtp.findFirst({
      where: { userId, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('common.errors.otp_not_found');
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('common.errors.otp_expired');
    }
    if (otp.attempts >= 5) {
      throw new BadRequestException('common.errors.otp_too_many_attempts');
    }
    const valid = await bcrypt.compare(code, otp.codeHash);
    if (!valid) {
      await this.prisma.passwordOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('common.errors.otp_invalid');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.passwordOtp.update({
        where: { id: otp.id },
        data: { consumed: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
    ]);
    return { success: true };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user) {
      throw new UnauthorizedException('common.errors.invalid_credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('common.errors.account_disabled');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('common.errors.invalid_credentials');
    }

    await this.usersService.updateLastLogin(user.id);
    return this.issue(user);
  }

  /** Public username/email availability check for the sign-up form. */
  checkAvailability(username?: string, email?: string) {
    return this.usersService.checkAvailability(username, email);
  }

  /** Self sign-up: creates an employee record + a login account, then logs in. */
  async register(dto: RegisterDto) {
    if (await this.usersService.isEmailTaken(dto.email)) {
      throw new ConflictException('common.errors.email_taken');
    }
    // username is the login identifier — it must be free.
    const takenUsername = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (takenUsername) {
      throw new ConflictException('common.errors.username_taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Assign the active work schedule (falling back to any) to the new employee.
    const defaultSchedule =
      (await this.prisma.workSchedule.findFirst({
        where: { isActive: true },
        select: { id: true },
      })) ??
      (await this.prisma.workSchedule.findFirst({ select: { id: true } }));

    // Sequential employee code (EMP00001…), retrying if two sign-ups collide.
    let user: Awaited<ReturnType<typeof this.usersService.findOne>> | null = null;
    for (let attempt = 0; attempt < 5 && !user; attempt++) {
      const employeeCode = await this.employeesService.generateEmployeeCode();
      try {
        user = await this.prisma.$transaction(async (tx) => {
          const employee = await tx.employee.create({
            data: {
              employeeCode,
              firstName: dto.firstName,
              lastName: dto.lastName,
              // email lives on the account only (auth.users), not here.
              phone: dto.phone ?? null,
              birthDate: dto.birthDate ? toDateOnly(dto.birthDate) : null,
              departmentId: dto.departmentId ?? null,
              positionId: dto.positionId ?? null,
              workScheduleId: defaultSchedule?.id ?? null,
            },
          });
          const created = await tx.user.create({
            data: {
              email: dto.email,
              username: dto.username,
              passwordHash,
              role: Role.employee,
              employeeId: employee.id,
            },
          });
          // Self sign-up: the employee record and the account are authored by
          // the new user itself (created_by = own user). This is still creation,
          // so updated_by / updated_at stay null.
          await tx.employee.update({
            where: { id: employee.id },
            data: { createdById: created.id },
          });
          await tx.user.update({
            where: { id: created.id },
            data: { createdById: created.id },
          });
          return created;
        });
      } catch (e) {
        const target = ((e as any)?.meta?.target ?? []) as string[];
        // A duplicate email/username is a client error — don't retry, report it.
        if ((e as { code?: string })?.code === 'P2002' && target.includes('email')) {
          throw new ConflictException('common.errors.email_taken');
        }
        if ((e as { code?: string })?.code === 'P2002' && target.includes('username')) {
          throw new ConflictException('common.errors.username_taken');
        }
        // Otherwise assume an employee-code collision → regenerate & retry.
        if ((e as { code?: string })?.code === 'P2002' && attempt < 4) {
          continue;
        }
        throw e;
      }
    }

    return this.issue(user!);
  }

  /** Self-service update of the logged-in employee's profile. */
  async updateProfile(
    employeeId: string | null,
    dto: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      birthDate?: string;
    },
    actorId?: string,
  ) {
    if (!employeeId) {
      throw new UnauthorizedException('common.errors.employee_not_found');
    }
    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.birthDate !== undefined) {
      data.birthDate = dto.birthDate ? toDateOnly(dto.birthDate) : null;
    }
    // The employee edits their own profile (updated_by = own user).
    data.updatedAt = new Date();
    if (actorId) data.updatedById = actorId;
    return this.prisma.employee.update({
      where: { id: employeeId },
      data,
    });
  }

  /** Changes the logged-in user's password after verifying the current one. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.usersService.findOne(userId);
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('common.errors.wrong_password');
    }
    await this.usersService.update(userId, { password: newPassword });
    return { success: true };
  }

  /** Exchanges a valid refresh token for a fresh access + refresh token pair. */
  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('common.errors.invalid_token');
    }
    // Ensure the account still exists and is active.
    const user = await this.usersService.findOne(payload.sub).catch(() => null);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('common.errors.invalid_token');
    }
    return this.issue(user);
  }

  /** Signs an access + refresh token and returns them with the user payload. */
  private async issue(user: {
    id: string;
    email: string;
    username: string | null;
    role: Role;
    employeeId: string | null;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      employeeId: user.employeeId,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        employeeId: user.employeeId,
      },
    };
  }
}
