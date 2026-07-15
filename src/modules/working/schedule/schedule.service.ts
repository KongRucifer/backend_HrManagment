import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkSchedule } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { attachActors } from '../../../shared/utils/actor.util';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

/** Normalizes "HH:mm" to "HH:mm:ss" so times store consistently. */
const normalizeTime = (t?: string) =>
  t === undefined ? undefined : t.length === 5 ? `${t}:00` : t;

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creating a schedule makes it the active one; all others become inactive. */
  async create(dto: CreateScheduleDto, actorId?: string): Promise<WorkSchedule> {
    return this.prisma.$transaction(async (tx) => {
      await tx.workSchedule.updateMany({ data: { isActive: false } });
      return tx.workSchedule.create({
        data: {
          name: dto.name,
          startTime: normalizeTime(dto.startTime)!,
          endTime: normalizeTime(dto.endTime)!,
          lateAfterMinutes: dto.lateAfterMinutes,
          isActive: true,
          // On create, record only who created it (updated_by/at stay null).
          createdById: actorId ?? null,
        },
      });
    });
  }

  async findAll() {
    const schedules = await this.prisma.workSchedule.findMany({
      orderBy: [{ isActive: 'desc' }, { startTime: 'asc' }],
    });
    return attachActors(this.prisma, schedules);
  }

  /** The current active schedule (or null if none). */
  getActive(): Promise<WorkSchedule | null> {
    return this.prisma.workSchedule.findFirst({ where: { isActive: true } });
  }

  /** Makes one schedule active and deactivates the rest. */
  async activate(id: string, actorId?: string): Promise<WorkSchedule> {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.workSchedule.updateMany({ data: { isActive: false } });
      return tx.workSchedule.update({
        where: { id },
        data: {
          isActive: true,
          updatedAt: new Date(),
          updatedById: actorId ?? undefined,
        },
      });
    });
  }

  async findOne(id: string): Promise<WorkSchedule> {
    const schedule = await this.prisma.workSchedule.findUnique({
      where: { id },
    });
    if (!schedule) {
      throw new NotFoundException('common.errors.schedule_not_found');
    }
    return schedule;
  }

  async update(
    id: string,
    dto: UpdateScheduleDto,
    actorId?: string,
  ): Promise<WorkSchedule> {
    await this.findOne(id);
    return this.prisma.workSchedule.update({
      where: { id },
      data: {
        name: dto.name,
        startTime: normalizeTime(dto.startTime),
        endTime: normalizeTime(dto.endTime),
        lateAfterMinutes: dto.lateAfterMinutes,
        updatedAt: new Date(),
        updatedById: actorId ?? undefined,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.workSchedule.delete({ where: { id } });
  }
}
