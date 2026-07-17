import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OfficeLocation, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { attachActors } from '../../../shared/utils/actor.util';
import { CreateOfficeLocationDto } from './dto/create-office-location.dto';
import { UpdateOfficeLocationDto } from './dto/update-office-location.dto';

/** Metres between two lat/lng points (Haversine). */
function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

@Injectable()
export class GpsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Admin CRUD ----
  create(
    dto: CreateOfficeLocationDto,
    actorId?: string,
  ): Promise<OfficeLocation> {
    return this.prisma.officeLocation.create({
      data: {
        ...dto,
        // On create, record only who created it (updated_by/at stay null).
        createdById: actorId ?? null,
      },
    });
  }

  async findAll() {
    const rows = await this.prisma.officeLocation.findMany({
      orderBy: { name: 'asc' },
    });
    return attachActors(this.prisma, rows);
  }

  async findOne(id: string): Promise<OfficeLocation> {
    const row = await this.prisma.officeLocation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('common.errors.not_found');
    return row;
  }

  async update(
    id: string,
    dto: UpdateOfficeLocationDto,
    actorId?: string,
  ): Promise<OfficeLocation> {
    await this.findOne(id);
    const data: Prisma.OfficeLocationUpdateInput = { ...dto };
    // Stamp who/when on every edit (updatedAt is manual, not @updatedAt).
    data.updatedAt = new Date();
    if (actorId) data.updatedById = actorId;
    return this.prisma.officeLocation.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.officeLocation.delete({ where: { id } });
  }

  // ---- Verification (used by check-in / check-out) ----
  /**
   * Server-side GPS check. Accepts the coordinates only when they fall within
   * an active office's radius. The nearest office is chosen so the error can
   * report how far off the user was. Never trusts a client-side verdict.
   */
  async verifyOrThrow(
    lat: number,
    lng: number,
  ): Promise<{ location: OfficeLocation; distance: number }> {
    const offices = await this.prisma.officeLocation.findMany({
      where: { isActive: true },
    });
    if (offices.length === 0) {
      // No geofence configured — a GPS check-in cannot be validated at all.
      throw new ForbiddenException('common.errors.no_office_location');
    }

    let nearest: OfficeLocation | null = null;
    let nearestDist = Infinity;
    for (const o of offices) {
      const d = distanceMeters(lat, lng, o.latitude, o.longitude);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = o;
      }
    }

    if (!nearest || nearestDist > nearest.radiusMeters) {
      throw new ForbiddenException('common.errors.outside_office');
    }
    return { location: nearest, distance: nearestDist };
  }
}
