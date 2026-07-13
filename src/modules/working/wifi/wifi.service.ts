import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WifiNetwork } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateWifiDto } from './dto/create-wifi.dto';
import { UpdateWifiDto } from './dto/update-wifi.dto';

@Injectable()
export class WifiService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Admin CRUD ----
  create(dto: CreateWifiDto): Promise<WifiNetwork> {
    return this.prisma.wifiNetwork.create({
      data: { ...dto, bssid: dto.bssid.toLowerCase() },
    });
  }

  findAll(): Promise<WifiNetwork[]> {
    return this.prisma.wifiNetwork.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string): Promise<WifiNetwork> {
    const wifi = await this.prisma.wifiNetwork.findUnique({ where: { id } });
    if (!wifi) {
      throw new NotFoundException('common.errors.wifi_not_found');
    }
    return wifi;
  }

  async update(id: string, dto: UpdateWifiDto): Promise<WifiNetwork> {
    await this.findOne(id);
    const data = { ...dto };
    if (dto.bssid) {
      data.bssid = dto.bssid.toLowerCase();
    }
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
