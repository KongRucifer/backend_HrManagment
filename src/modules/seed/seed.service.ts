import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/**
 * Office WiFi networks to seed. Add a row per access point / band — check-in
 * requires an EXACT ssid + bssid match, so a dual-band router needs BOTH its
 * 2.4GHz and 5GHz BSSIDs here. Edit this list and restart to re-seed.
 * (bssid is stored lowercase; the entries below may be in any case.)
 */
const DEFAULT_WIFIS: Array<{
  name: string;
  ssid: string;
  bssid: string;
  wifiCode?: string;
}> = [
  {
    name: 'ຫ້ອງການ LTS (5GHz)',
    ssid: 'LTS_Ventures',
    bssid: '9c:2b:a6:b2:91:4c',
  },
  // Add the 2.4GHz / other APs here, e.g.:
  // { name: 'ຫ້ອງການ LTS (2.4GHz)', ssid: 'LTS_Ventures', bssid: 'xx:xx:xx:xx:xx:xx' },
];

/**
 * Ensures the app is usable out of the box: a default admin login, a default
 * work schedule (09:00–17:30) assigned to employees who don't have one, and the
 * office WiFi network(s) used to gate check-in / check-out.
 */
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdmin();
    await this.seedDefaultSchedule();
    await this.seedDefaultWifi();
  }

  private async seedDefaultWifi(): Promise<void> {
    for (const w of DEFAULT_WIFIS) {
      const bssid = w.bssid.toLowerCase();
      const exists = await this.prisma.wifiNetwork.findFirst({
        where: { ssid: w.ssid, bssid },
      });
      if (exists) continue;
      await this.prisma.wifiNetwork.create({
        data: {
          name: w.name,
          ssid: w.ssid,
          bssid,
          wifiCode: w.wifiCode,
          isActive: true,
        },
      });
      this.logger.log(`Seeded WiFi "${w.name}" (${w.ssid} / ${bssid})`);
    }
  }

  private async seedAdmin(): Promise<void> {
    const email = this.config.get<string>('seed.adminEmail') || 'admin@hrapp.la';
    const username = this.config.get<string>('seed.adminUsername') || 'admin';
    const password = this.config.get<string>('seed.adminPassword') || 'admin123';

    if (await this.usersService.findByEmail(email)) return;

    await this.usersService.create({ email, username, password, role: Role.admin });
    this.logger.log(`Seeded default admin account: "${email}"`);
  }

  private async seedDefaultSchedule(): Promise<void> {
    let schedule = await this.prisma.workSchedule.findFirst();
    if (!schedule) {
      schedule = await this.prisma.workSchedule.create({
        data: {
          name: 'ກະປົກກະຕິ',
          startTime: '09:00:00',
          endTime: '17:30:00',
          lateAfterMinutes: 15,
        },
      });
      this.logger.log('Seeded default work schedule 09:00–17:30');
    }
    // Give any employees without a schedule the default one.
    const res = await this.prisma.employee.updateMany({
      where: { workScheduleId: null },
      data: { workScheduleId: schedule.id },
    });
    if (res.count) {
      this.logger.log(`Assigned default schedule to ${res.count} employees`);
    }
  }
}
