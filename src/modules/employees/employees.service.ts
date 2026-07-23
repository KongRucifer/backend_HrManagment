import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Employee, Prisma, Role, User } from '@prisma/client';
import { PaginatedResult } from '../../shared/dto/pagination.dto';
import { ActorRef, attachActors } from '../../shared/utils/actor.util';
import { getWorkDate, toDateOnly } from '../../shared/utils/datetime.util';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const employeeInclude = {
  department: true,
  workSchedule: true,
  positionRef: true,
} satisfies Prisma.EmployeeInclude;

export type EmployeeWithRelations = Prisma.EmployeeGetPayload<{
  include: typeof employeeInclude;
}>;

export type EmployeeListItem = EmployeeWithRelations & {
  createdBy: ActorRef | null;
  updatedBy: ActorRef | null;
  /** The linked login account (email/username live there now), if any. */
  account: { username: string; email: string } | null;
};

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Next sequential employee code, e.g. EMP00001, EMP00002, ...
   * (based on the current maximum; callers retry on a unique conflict).
   */
  async generateEmployeeCode(): Promise<string> {
    // Consider only strict EMP##### codes (ignore any legacy formats).
    const rows = await this.prisma.employee.findMany({
      where: { employeeCode: { startsWith: 'EMP' } },
      select: { employeeCode: true },
    });
    let max = 0;
    for (const r of rows) {
      if (/^EMP\d+$/.test(r.employeeCode)) {
        max = Math.max(max, parseInt(r.employeeCode.slice(3), 10));
      }
    }
    return `EMP${(max + 1).toString().padStart(5, '0')}`;
  }

  async create(dto: CreateEmployeeDto, actorId?: string): Promise<Employee> {
    // Auto-assign the active work schedule when none is provided.
    let workScheduleId = dto.workScheduleId ?? null;
    if (!workScheduleId) {
      const active = await this.prisma.workSchedule.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      workScheduleId = active?.id ?? null;
    }

    // Resolve the login account up-front (when linking an existing one) so it is
    // validated BEFORE creating the employee — this avoids leaving an orphaned
    // employee behind if a later step fails.
    let linkUser: User | null = null;
    if (dto.createAccount && dto.existingUserId) {
      linkUser = await this.prisma.user.findUnique({
        where: { id: dto.existingUserId },
      });
      if (!linkUser) {
        throw new NotFoundException('common.errors.user_not_found');
      }
      if (linkUser.employeeId) {
        throw new BadRequestException('common.errors.account_already_linked');
      }
    }

    // A brand-new account needs a free email / username — check before creating
    // the employee so a conflict can't orphan one.
    if (dto.createAccount && !linkUser) {
      if (!dto.email) {
        throw new BadRequestException('common.errors.login_email_required');
      }
      if (await this.usersService.isEmailTaken(dto.email)) {
        throw new ConflictException('common.errors.email_taken');
      }
    }

    const base = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone ?? null,
      departmentId: dto.departmentId ?? null,
      positionId: dto.positionId ?? null,
      birthDate: dto.birthDate ? toDateOnly(dto.birthDate) : null,
      contractEndDate: dto.contractEndDate
        ? toDateOnly(dto.contractEndDate)
        : null,
      // Status defaults to "active" (schema default) unless explicitly set.
      status: dto.status,
      workScheduleId,
      // On create we record only who created it — updated_by/updated_at stay null
      // until the row is actually edited.
      createdById: actorId ?? null,
    };

    // Create with an auto-generated code, retrying if two requests collide.
    let employee: Employee | null = null;
    for (let attempt = 0; attempt < 5 && !employee; attempt++) {
      const employeeCode = dto.employeeCode || (await this.generateEmployeeCode());
      try {
        employee = await this.prisma.employee.create({
          data: { ...base, employeeCode },
        });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        // P2002 on the employee code = regenerate & retry.
        if (!dto.employeeCode && code === 'P2002' && attempt < 4) {
          continue;
        }
        throw e;
      }
    }

    if (!employee) {
      throw new BadRequestException('common.errors.employee_not_found');
    }

    // Optionally attach a login account for this employee: either link an
    // existing account, or provision a brand-new one (login is by email).
    if (dto.createAccount) {
      if (linkUser) {
        // Attach the (already validated) existing account to this new employee.
        await this.prisma.user.update({
          where: { id: linkUser.id },
          data: { employeeId: employee.id },
        });
      } else {
        await this.usersService.create(
          {
            email: dto.email!,
            username: dto.username ?? employee.employeeCode,
            password: dto.password ?? employee.employeeCode,
            role: dto.role ?? Role.employee,
            employeeId: employee.id,
          },
          actorId,
        );
      }
    }

    return employee;
  }

  /**
   * Head-count tiles for the Employees page. Matches the list population
   * (admin-linked employees are excluded). `active`/`inactive` count only rows
   * that are NOT soft-deleted (deletedAt = null); `deleted` is the bin.
   */
  async summary(): Promise<{
    total: number;
    active: number;
    inactive: number;
    deleted: number;
  }> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', employeeId: { not: null } },
      select: { employeeId: true },
    });
    const adminIds = admins
      .map((a) => a.employeeId)
      .filter((id): id is string => !!id);
    const notAdmin: Prisma.EmployeeWhereInput = adminIds.length
      ? { id: { notIn: adminIds } }
      : {};

    const [total, active, inactive, deleted] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { ...notAdmin, deletedAt: null } }),
      this.prisma.employee.count({
        where: { ...notAdmin, deletedAt: null, status: 'active' },
      }),
      this.prisma.employee.count({
        where: { ...notAdmin, deletedAt: null, status: 'inactive' },
      }),
      this.prisma.employee.count({
        where: { ...notAdmin, deletedAt: { not: null } },
      }),
    ]);
    return { total, active, inactive, deleted };
  }

  async findAll(
    query: QueryEmployeeDto,
  ): Promise<PaginatedResult<EmployeeListItem>> {
    const showDeleted = query.deleted === 'true';
    const where: Prisma.EmployeeWhereInput = {
      // Active list vs the soft-deleted bin.
      deletedAt: showDeleted ? { not: null } : null,
    };

    // Exclude employees whose linked account is an admin (not shown here).
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', employeeId: { not: null } },
      select: { employeeId: true },
    });
    const adminEmployeeIds = admins
      .map((a) => a.employeeId)
      .filter((id): id is string => !!id);
    if (adminEmployeeIds.length) {
      where.id = { notIn: adminEmployeeIds };
    }

    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.status = query.status;
    if (query.search) {
      // Username lives on the linked account (a separate schema, no relation),
      // so resolve the matching employeeIds first and fold them into the OR.
      const matchingAccounts = await this.prisma.user.findMany({
        where: {
          username: { contains: query.search, mode: 'insensitive' },
          employeeId: { not: null },
        },
        select: { employeeId: true },
      });
      const usernameEmployeeIds = matchingAccounts
        .map((u) => u.employeeId)
        .filter((id): id is string => !!id);
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { employeeCode: { contains: query.search, mode: 'insensitive' } },
        ...(usernameEmployeeIds.length
          ? [{ id: { in: usernameEmployeeIds } }]
          : []),
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: employeeInclude,
        orderBy: { employeeCode: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    // Email/username live on the login account — attach them for display.
    const withActors = await attachActors(this.prisma, items);
    const accounts = await this.usersService.accountsOfEmployees(
      items.map((e) => e.id),
    );

    return {
      items: withActors.map((e) => ({
        ...e,
        account: accounts.get(e.id) ?? null,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findOne(id: string): Promise<EmployeeWithRelations> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: employeeInclude,
    });
    if (!employee) {
      throw new NotFoundException('common.errors.employee_not_found');
    }
    return employee;
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    actorId?: string,
  ): Promise<Employee> {
    const current = await this.findOne(id);
    const data: Prisma.EmployeeUpdateInput = {};
    // Stamp who/when on every edit (updatedAt is manual now — not @updatedAt).
    data.updatedAt = new Date();
    if (actorId) data.updatedById = actorId;
    if (dto.employeeCode !== undefined) data.employeeCode = dto.employeeCode;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.birthDate !== undefined) {
      data.birthDate = dto.birthDate ? toDateOnly(dto.birthDate) : null;
    }
    if (dto.contractEndDate !== undefined) {
      data.contractEndDate = dto.contractEndDate
        ? toDateOnly(dto.contractEndDate)
        : null;
    }
    if (dto.departmentId !== undefined) {
      data.department = dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : { disconnect: true };
    }
    if (dto.positionId !== undefined) {
      data.positionRef = dto.positionId
        ? { connect: { id: dto.positionId } }
        : { disconnect: true };
    }
    if (dto.workScheduleId !== undefined) {
      data.workSchedule = dto.workScheduleId
        ? { connect: { id: dto.workScheduleId } }
        : { disconnect: true };
    }

    // Keep the linked login account's active flag in sync with the employee's
    // status: active -> the account can log in, inactive -> it is disabled. Done
    // in one transaction so the two can never drift apart.
    const [updated] = await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id }, data }),
      ...(dto.status !== undefined
        ? [
            this.prisma.user.updateMany({
              where: { employeeId: id, deletedAt: null },
              data: {
                isActive: dto.status === 'active',
                updatedAt: new Date(),
                ...(actorId ? { updatedById: actorId } : {}),
              },
            }),
          ]
        : []),
    ]);
    return updated as Employee;
  }

  /**
   * Soft delete: mark the employee (and its linked login account) as deleted
   * instead of removing the row, so it can be restored or hard-deleted later.
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id }, data: { deletedAt: now } }),
      this.prisma.user.updateMany({
        where: { employeeId: id },
        data: { deletedAt: now },
      }),
    ]);
  }

  /** Undo a soft delete on the employee and its linked account. */
  async restore(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id }, data: { deletedAt: null } }),
      this.prisma.user.updateMany({
        where: { employeeId: id },
        data: { deletedAt: null },
      }),
    ]);
  }

  /**
   * Permanent, irreversible delete of the employee and its linked login account
   * — plus that account's push device tokens / notifications, which reference
   * the user by a cross-schema scalar (no FK cascade), so must be cleared here.
   */
  async hardRemove(id: string): Promise<void> {
    await this.findOne(id);
    const users = await this.prisma.user.findMany({
      where: { employeeId: id },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    await this.prisma.$transaction([
      this.prisma.deviceToken.deleteMany({ where: { userId: { in: userIds } } }),
      this.prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
      this.prisma.user.deleteMany({ where: { employeeId: id } }),
      this.prisma.employee.delete({ where: { id } }),
    ]);
  }

  /**
   * Birthdays today + upcoming within `withinDays` (compares month/day, ignores
   * year). Employees sharing a date are all included.
   */
  async birthdays(withinDays = 2) {
    const employees = await this.prisma.employee.findMany({
      where: { status: 'active', birthDate: { not: null }, deletedAt: null },
      include: { department: true },
    });

    const DAY = 86_400_000;
    const [ty, tm, td] = getWorkDate().split('-').map(Number);
    const todayUTC = Date.UTC(ty, tm - 1, td);

    const today: any[] = [];
    const upcoming: any[] = [];

    for (const e of employees) {
      const b = e.birthDate as Date; // @db.Date -> UTC midnight
      const bMonth = b.getUTCMonth();
      const bDay = b.getUTCDate();

      // Next occurrence of the birthday (this year, or next if already passed).
      let year = ty;
      let cand = Date.UTC(ty, bMonth, bDay);
      if (cand < todayUTC) {
        year = ty + 1;
        cand = Date.UTC(year, bMonth, bDay);
      }
      const daysLeft = Math.round((cand - todayUTC) / DAY);

      const base = {
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        department: e.department?.name ?? null,
        birthDate: b.toISOString().slice(0, 10),
        daysLeft,
      };

      if (daysLeft === 0) {
        today.push({ ...base, age: ty - b.getUTCFullYear() });
      } else if (daysLeft <= withinDays) {
        upcoming.push({ ...base, age: year - b.getUTCFullYear() });
      }
    }

    upcoming.sort((a, b) => a.daysLeft - b.daysLeft);
    return { today, upcoming, withinDays };
  }
}
