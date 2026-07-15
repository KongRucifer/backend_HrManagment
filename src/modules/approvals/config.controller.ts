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
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApproverLookupService } from './approver-lookup.service';
import { ConfigService } from './config.service';

class UserIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds: string[];
}
/** Create/update payload for a leave or emergency type. */
class TypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@ApiTags('approvals / config')
@ApiBearerAuth()
@Roles(Role.admin)
@Controller('approvals')
export class ConfigController {
  constructor(
    private readonly config: ConfigService,
    private readonly lookup: ApproverLookupService,
  ) {}

  /** Searchable approver candidates (for the add-approver modal). */
  @Get('candidates')
  candidates(@Query('search') search?: string) {
    return this.lookup.candidates(search);
  }

  // ---- Leave chain ----
  @Get('leave-chain')
  getChain() {
    return this.config.getChain();
  }

  @Post('leave-chain')
  addChain(@Body() dto: UserIdsDto) {
    return this.config.addChainApprovers(dto.userIds);
  }

  @Patch('leave-chain/reorder')
  reorderChain(@Body() dto: UserIdsDto) {
    return this.config.reorderChain(dto.userIds);
  }

  @Delete('leave-chain/:id')
  removeChain(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.removeChainApprover(id);
  }

  // ---- Leave types ----
  @Get('leave-types')
  leaveTypes() {
    return this.config.listLeaveTypes();
  }

  @Post('leave-types')
  createLeaveType(@Body() dto: TypeDto) {
    return this.config.createLeaveType(dto.name ?? '');
  }

  @Patch('leave-types/:id')
  updateLeaveType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TypeDto) {
    return this.config.updateLeaveType(id, dto);
  }

  @Delete('leave-types/:id')
  deleteLeaveType(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.deleteLeaveType(id);
  }

  // ---- Emergency (ສຸກເສີນ) types ----
  @Get('emergency-types')
  emergencyTypes() {
    return this.config.listEmergencyTypes();
  }

  @Post('emergency-types')
  createEmergencyType(@Body() dto: TypeDto) {
    return this.config.createEmergencyType(dto.name ?? '');
  }

  @Patch('emergency-types/:id')
  updateEmergencyType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TypeDto,
  ) {
    return this.config.updateEmergencyType(id, dto);
  }

  @Delete('emergency-types/:id')
  deleteEmergencyType(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.deleteEmergencyType(id);
  }

  // ---- Emergency approver pool ----
  @Get('emergency-pool')
  emergencyPool() {
    return this.config.getEmergencyPool();
  }

  @Post('emergency-pool')
  addPool(@Body() dto: UserIdsDto) {
    return this.config.addEmergencyApprovers(dto.userIds);
  }

  @Delete('emergency-pool/:id')
  removePool(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.removeEmergencyApprover(id);
  }
}
