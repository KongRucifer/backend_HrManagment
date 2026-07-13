import { Injectable, NotFoundException } from '@nestjs/common';
import { Position } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreatePositionDto): Promise<Position> {
    return this.prisma.position.create({ data: dto });
  }

  /** All positions, optionally filtered by department. */
  findAll(departmentId?: string): Promise<Position[]> {
    return this.prisma.position.findMany({
      where: departmentId ? { departmentId } : undefined,
      include: { department: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<Position> {
    const position = await this.prisma.position.findUnique({ where: { id } });
    if (!position) {
      throw new NotFoundException('common.errors.position_not_found');
    }
    return position;
  }

  async update(id: string, dto: UpdatePositionDto): Promise<Position> {
    await this.findOne(id);
    return this.prisma.position.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.position.delete({ where: { id } });
  }
}
