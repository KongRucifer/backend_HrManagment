import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Roles(Role.admin)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser('userId') actorId: string) {
    return this.usersService.create(dto, actorId);
  }

  @Get()
  findAll(
    @Query('deleted') deleted?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.findAll({
      deleted: deleted === 'true',
      search: search?.trim() || undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Declared before ":id" so "availability" isn't parsed as a UUID param.
  @Get('availability')
  checkAvailability(
    @Query('username') username?: string,
    @Query('email') email?: string,
  ) {
    return this.usersService.checkAvailability(username, email);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.usersService.update(id, dto, actorId);
  }

  /** Soft delete — marks the account (and its employee) deleted. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }

  /** Restore a soft-deleted account (and its employee). */
  @Post(':id/restore')
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.restore(id);
  }

  /** Permanent, irreversible delete. */
  @Delete(':id/hard')
  hardRemove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.hardRemove(id);
  }
}
