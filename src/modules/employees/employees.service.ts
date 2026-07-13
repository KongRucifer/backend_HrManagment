import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Employee, Prisma, Role } from '@prisma/client';
import { PaginatedResult } from '../../shared/dto/pagination.dto';
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

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    // Auto-assign the active work schedule when none is provided.
    let workScheduleId = dto.workScheduleId ?? null;
    if (!workScheduleId) {
      const active = await this.prisma.workSchedule.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      workScheduleId = active?.id ?? null;
    }

    const base = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      departmentId: dto.departmentId ?? null,
      position: dto.position ?? null,
      positionId: dto.positionId ?? null,
      birthDate: dto.birthDate ? toDateOnly(dto.birthDate) : null,
      hireDate: dto.hireDate ? toDateOnly(dto.hireDate) : null,
      // Status defaults to "active" (schema default) unless explicitly set.
      status: dto.status,
      workScheduleId,
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
        // P2002 = unique constraint (code already taken) -> regenerate & retry.
        if (
          !dto.employeeCode &&
          (e as { code?: string })?.code === 'P2002' &&
          attempt < 4
        ) {
          continue;
        }
        throw e;
      }
    }

    if (!employee) {
      throw new BadRequestException('common.errors.employee_not_found');
    }

    // Optionally provision a login account (login is by email) for this employee.
    if (dto.createAccount) {
      const email = dto.loginEmail ?? dto.email;
      if (!email) {
        throw new BadRequestException('common.errors.login_email_required');
      }
      await this.usersService.create({
        email,
        username: dto.username ?? employee.employeeCode,
        password: dto.password ?? employee.employeeCode,
        role: dto.role ?? Role.employee,
        employeeId: employee.id,
      });
    }

    return employee;
  }

  async findAll(
    query: QueryEmployeeDto,
  ): Promise<PaginatedResult<EmployeeWithRelations>> {
    const where: Prisma.EmployeeWhereInput = {};

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
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { employeeCode: { contains: query.search, mode: 'insensitive' } },
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

    return {
      items,
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

  async update(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    await this.findOne(id);
    const data: Prisma.EmployeeUpdateInput = {};
    if (dto.employeeCode !== undefined) data.employeeCode = dto.employeeCode;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.birthDate !== undefined) {
      data.birthDate = dto.birthDate ? toDateOnly(dto.birthDate) : null;
    }
    if (dto.hireDate !== undefined) {
      data.hireDate = dto.hireDate ? toDateOnly(dto.hireDate) : null;
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
    return this.prisma.employee.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    // Deleting an employee also removes its linked login account.
    await this.prisma.$transaction([
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
      where: { status: 'active', birthDate: { not: null } },
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
