import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { FcmService } from './fcm.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    // Registered here rather than imported from AuthModule (which does not
    // export it): AuthModule already depends on this module, so importing it
    // back would be circular.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, FcmService, NotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
