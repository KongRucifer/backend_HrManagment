import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import {
  AuthUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

class RegisterTokenDto {
  @IsString()
  token: string;

  @IsOptional()
  @IsString()
  platform?: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.userId);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.userId).then((count) => ({ count }));
  }

  @Patch('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user.userId);
  }

  @Patch(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.markRead(user.userId, id);
  }

  @Post('device-token')
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterTokenDto) {
    return this.service.registerToken(user.userId, dto.token, dto.platform);
  }

  @Delete('device-token')
  remove(@Body() dto: RegisterTokenDto) {
    return this.service.removeToken(dto.token);
  }
}
