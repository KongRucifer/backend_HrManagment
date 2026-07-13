import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { toDateOnly } from '../../shared/utils/datetime.util';
import { EmployeesService } from '../employees/employees.service';
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
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
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

  /** Self sign-up: creates an employee record + a login account, then logs in. */
  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('common.errors.email_taken');
    }
    if (dto.username) {
      const takenUsername = await this.prisma.user.findUnique({
        where: { username: dto.username },
      });
      if (takenUsername) {
        throw new ConflictException('common.errors.username_taken');
      }
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
              email: dto.email,
              phone: dto.phone ?? null,
              birthDate: dto.birthDate ? toDateOnly(dto.birthDate) : null,
              departmentId: dto.departmentId ?? null,
              positionId: dto.positionId ?? null,
              workScheduleId: defaultSchedule?.id ?? null,
            },
          });
          return tx.user.create({
            data: {
              email: dto.email,
              username: dto.username ?? null,
              passwordHash,
              role: Role.employee,
              employeeId: employee.id,
            },
          });
        });
      } catch (e) {
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
