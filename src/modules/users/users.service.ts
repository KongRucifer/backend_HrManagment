import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { attachActors } from '../../shared/utils/actor.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto, actorId?: string): Promise<User> {
    // Email must be unique across accounts AND employee records — except the
    // employee this account is being linked to: sharing that record's email is
    // expected (it's the same person, e.g. "create employee + account").
    if (await this.isEmailTaken(dto.email, dto.employeeId ?? undefined)) {
      throw new ConflictException('common.errors.email_taken');
    }
    // username is the login id and @unique — reject duplicates up-front so the
    // client gets a clear 409 instead of an unhandled Prisma P2002.
    const existingUsername = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existingUsername) {
      throw new ConflictException('common.errors.username_taken');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          username: dto.username,
          passwordHash,
          role: dto.role,
          employeeId: dto.employeeId ?? null,
          isActive: dto.isActive ?? true,
          // On create we record only who created it — updated_by/updated_at stay
          // null until the row is actually edited.
          createdById: actorId ?? null,
        },
      });
    } catch (e) {
      // Safety net for a race between the checks above and the insert.
      if ((e as { code?: string })?.code === 'P2002') {
        const target = ((e as any)?.meta?.target ?? []) as string[];
        throw new ConflictException(
          target.includes('username')
            ? 'common.errors.username_taken'
            : 'common.errors.email_taken',
        );
      }
      throw e;
    }
  }

  /**
   * Live availability check used by the admin create forms (debounced client
   * side). Each field is only evaluated when provided; unevaluated -> null.
   *
   * Email must be unique across the WHOLE system, so it's "taken" if it already
   * belongs to a login account OR an employee record.
   */
  async checkAvailability(
    username?: string,
    email?: string,
  ): Promise<{ usernameAvailable: boolean | null; emailAvailable: boolean | null }> {
    const [usernameHit, emailTaken] = await Promise.all([
      username
        ? this.prisma.user.findUnique({
            where: { username },
            select: { id: true },
          })
        : Promise.resolve(null),
      email ? this.isEmailTaken(email) : Promise.resolve(false),
    ]);
    return {
      usernameAvailable: username ? !usernameHit : null,
      emailAvailable: email ? !emailTaken : null,
    };
  }

  /**
   * True if `email` already belongs to a login account.
   * Email lives only on auth.users now, so this is a single lookup.
   */
  async isEmailTaken(email: string, ignoreUserId?: string): Promise<boolean> {
    const hit = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return !!hit && hit.id !== ignoreUserId;
  }

  /**
   * List accounts, filtered by soft-delete state (active by default) and an
   * optional username/email search.
   */
  async findAll(
    opts: {
      deleted?: boolean;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 10;

    const where: Prisma.UserWhereInput = {
      // deletedAt: null -> active; { not: null } -> the deleted bin.
      deletedAt: opts.deleted ? { not: null } : null,
    };
    if (opts.search) {
      where.OR = [
        { username: { contains: opts.search, mode: 'insensitive' } },
        { email: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { username: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: await attachActors(this.prisma, rows),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('common.errors.user_not_found');
    }
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Login lookup — username is the login identifier. */
  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  /** The login accounts for a set of employees, keyed by employeeId. */
  async accountsOfEmployees(
    employeeIds: string[],
  ): Promise<Map<string, { username: string; email: string }>> {
    if (employeeIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, username: true, email: true },
    });
    return new Map(
      users
        .filter((u) => u.employeeId)
        .map((u) => [u.employeeId as string, { username: u.username, email: u.email }]),
    );
  }

  async update(id: string, dto: UpdateUserDto, actorId?: string): Promise<User> {
    await this.findOne(id);
    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.employeeId !== undefined) data.employeeId = dto.employeeId;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }
    // Stamp who/when on every edit (updatedAt is manual now — not @updatedAt).
    data.updatedAt = new Date();
    if (actorId) data.updatedById = actorId;
    return this.prisma.user.update({ where: { id }, data });
  }

  /**
   * Soft delete: mark the account (and its linked employee) as deleted instead
   * of removing the row. It disappears from the active lists and can no longer
   * log in, but can be restored or hard-deleted later.
   */
  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { deletedAt: now } }),
      ...(user.employeeId
        ? [
            this.prisma.employee.updateMany({
              where: { id: user.employeeId },
              data: { deletedAt: now },
            }),
          ]
        : []),
    ]);
  }

  /** Undo a soft delete on the account and its linked employee. */
  async restore(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { deletedAt: null } }),
      ...(user.employeeId
        ? [
            this.prisma.employee.updateMany({
              where: { id: user.employeeId },
              data: { deletedAt: null },
            }),
          ]
        : []),
    ]);
  }

  /**
   * Permanently remove the account and its linked employee record, plus the
   * rows that reference the user by a cross-schema scalar (no FK cascade): its
   * push device tokens and in-app notifications. Irreversible.
   */
  async hardRemove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.deviceToken.deleteMany({ where: { userId: id } }),
      this.prisma.notification.deleteMany({ where: { userId: id } }),
      this.prisma.user.delete({ where: { id } }),
      ...(user.employeeId
        ? [this.prisma.employee.deleteMany({ where: { id: user.employeeId } })]
        : []),
    ]);
  }

  updateLastLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLogin: new Date() },
    });
  }
}
