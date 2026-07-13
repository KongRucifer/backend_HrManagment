import { Injectable, NotFoundException } from '@nestjs/common';
import { Department } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateDepartmentDto): Promise<Department> {
    return this.prisma.department.create({ data: dto });
  }

  findAll(): Promise<Department[]> {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<Department> {
    const dept = await this.prisma.department.findUnique({ where: { id } });
    if (!dept) {
      throw new NotFoundException('common.errors.department_not_found');
    }
    return dept;
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    await this.findOne(id);
    return this.prisma.department.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.department.delete({ where: { id } });
  }
}
