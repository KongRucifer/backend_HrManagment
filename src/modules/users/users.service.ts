import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('common.errors.email_taken');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username ?? null,
        passwordHash,
        role: dto.role,
        employeeId: dto.employeeId ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  findAll(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { username: 'asc' } });
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

  async update(id: string, dto: UpdateUserDto): Promise<User> {
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
    return this.prisma.user.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    // Deleting an account also removes its linked employee record.
    await this.prisma.$transaction([
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
