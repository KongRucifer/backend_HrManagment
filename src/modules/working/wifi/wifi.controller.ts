import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CreateWifiDto } from './dto/create-wifi.dto';
import { UpdateWifiDto } from './dto/update-wifi.dto';
import { WifiService } from './wifi.service';

@ApiTags('working / wifi')
@ApiBearerAuth()
@Roles(Role.admin)
@Controller('working/wifi')
export class WifiController {
  constructor(private readonly service: WifiService) {}

  @Post()
  create(@Body() dto: CreateWifiDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWifiDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
