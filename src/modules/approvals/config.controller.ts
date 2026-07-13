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
class SickTypeDto {
  @IsString()
  name: string;

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

  // ---- Sick types ----
  @Get('sick-types')
  sickTypes() {
    return this.config.listSickTypes();
  }

  @Post('sick-types')
  createSickType(@Body() dto: SickTypeDto) {
    return this.config.createSickType(dto.name);
  }

  @Patch('sick-types/:id')
  updateSickType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SickTypeDto) {
    return this.config.updateSickType(id, dto);
  }

  @Delete('sick-types/:id')
  deleteSickType(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.deleteSickType(id);
  }

  // ---- Sick approver pool ----
  @Get('sick-pool')
  sickPool() {
    return this.config.getSickPool();
  }

  @Post('sick-pool')
  addPool(@Body() dto: UserIdsDto) {
    return this.config.addSickApprovers(dto.userIds);
  }

  @Delete('sick-pool/:id')
  removePool(@Param('id', ParseUUIDPipe) id: string) {
    return this.config.removeSickApprover(id);
  }
}
