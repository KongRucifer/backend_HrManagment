import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WifiNetwork } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { attachActors } from '../../../shared/utils/actor.util';
import { CreateWifiDto } from './dto/create-wifi.dto';
import { UpdateWifiDto } from './dto/update-wifi.dto';

@Injectable()
export class WifiService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Admin CRUD ----
  create(dto: CreateWifiDto, actorId?: string): Promise<WifiNetwork> {
    return this.prisma.wifiNetwork.create({
      data: {
        ...dto,
        bssid: dto.bssid.toLowerCase(),
        // On create, record only who created it (updated_by/at stay null).
        createdById: actorId ?? null,
      },
    });
  }

  async findAll() {
    const networks = await this.prisma.wifiNetwork.findMany({
      orderBy: { name: 'asc' },
    });
    return attachActors(this.prisma, networks);
  }

  async findOne(id: string): Promise<WifiNetwork> {
    const wifi = await this.prisma.wifiNetwork.findUnique({ where: { id } });
    if (!wifi) {
      throw new NotFoundException('common.errors.wifi_not_found');
    }
    return wifi;
  }

  async update(
    id: string,
    dto: UpdateWifiDto,
    actorId?: string,
  ): Promise<WifiNetwork> {
    await this.findOne(id);
    const data: Prisma.WifiNetworkUpdateInput = { ...dto };
    if (dto.bssid) {
      data.bssid = dto.bssid.toLowerCase();
    }
    // Stamp who/when on every edit (updatedAt is manual now — not @updatedAt).
    data.updatedAt = new Date();
    if (actorId) data.updatedById = actorId;
    return this.prisma.wifiNetwork.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.wifiNetwork.delete({ where: { id } });
  }

  // ---- Verification (used by check-in / check-out) ----
  /**
   * Server-side WiFi check. The client sends the ssid + bssid it is currently
   * connected to; we only accept it if an active row matches BOTH.
   * bssid is the primary anchor (hard to spoof); ssid must also match.
   */
  async verifyOrThrow(ssid: string, bssid: string): Promise<WifiNetwork> {
    if (!ssid || !bssid) {
      throw new ForbiddenException('common.errors.wifi_required');
    }
    const wifi = await this.prisma.wifiNetwork.findFirst({
      where: {
        ssid,
        bssid: bssid.toLowerCase(),
        isActive: true,
      },
    });
    if (!wifi) {
      throw new ForbiddenException('common.errors.wifi_invalid');
    }
    return wifi;
  }
}
