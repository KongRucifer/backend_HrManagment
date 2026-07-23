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
import { BirthdayReminderService } from './birthday-reminder.service';
import { ContractReminderService } from './contract-reminder.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly service: EmployeesService,
    private readonly contracts: ContractReminderService,
    private readonly birthdayReminders: BirthdayReminderService,
  ) {}

  /**
   * Runs the contract-expiry reminder check now (the cron does this nightly).
   * Idempotent — safe to call repeatedly; only sends what isn't sent yet today.
   */
  @Roles(Role.admin)
  @Post('run-contract-check')
  runContractCheck() {
    return this.contracts.checkContracts();
  }

  /** Runs the birthday reminder check now (the cron does this nightly). */
  @Roles(Role.admin)
  @Post('run-birthday-check')
  runBirthdayCheck() {
    return this.birthdayReminders.checkBirthdays();
  }

  @Roles(Role.admin)
  @Post()
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.create(dto, actorId);
  }

  @Roles(Role.admin)
  @Get()
  findAll(@Query() query: QueryEmployeeDto) {
    return this.service.findAll(query);
  }

  // Any authenticated user can see birthdays. Defined before ":id".
  @Get('birthdays')
  birthdays(@Query('withinDays') withinDays?: string) {
    return this.service.birthdays(withinDays ? parseInt(withinDays, 10) : 2);
  }

  /** Head-count tiles (total / active / inactive / deleted). Before ":id". */
  @Roles(Role.admin)
  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Roles(Role.admin)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  /** Soft delete — marks the employee (and its account) deleted. */
  @Roles(Role.admin)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  /** Restore a soft-deleted employee (and its account). */
  @Roles(Role.admin)
  @Post(':id/restore')
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.restore(id);
  }

  /** Permanent, irreversible delete. */
  @Roles(Role.admin)
  @Delete(':id/hard')
  hardRemove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.hardRemove(id);
  }
}
