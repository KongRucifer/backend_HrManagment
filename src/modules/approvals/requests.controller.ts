import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import {
  AuthUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { ConfigService } from './config.service';
import { RequestsService } from './requests.service';

class CreateLeaveDto {
  @IsString()
  @MinLength(1)
  reason: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
class CreateSickDto {
  @IsUUID()
  sickTypeId: string;

  @IsUUID()
  approverUserId: string;

  @IsString()
  @MinLength(1)
  reason: string;
}
class DecideDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}

@ApiTags('requests')
@ApiBearerAuth()
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly config: ConfigService,
  ) {}

  // ---- form helpers (employee) ----
  /** Read-only leave approval chain (who will approve — employee can't choose). */
  @Get('leave-chain')
  leaveChain() {
    return this.config.getChain();
  }

  @Get('sick-types')
  sickTypes() {
    return this.config.listActiveSickTypes();
  }

  @Get('sick-approvers')
  sickApprovers() {
    return this.config.getSickPool();
  }

  // ---- create ----
  @Post('leave')
  createLeave(@CurrentUser() user: AuthUser, @Body() dto: CreateLeaveDto) {
    return this.requests.createLeave(this.emp(user), dto);
  }

  @Post('sick')
  createSick(@CurrentUser() user: AuthUser, @Body() dto: CreateSickDto) {
    return this.requests.createSick(this.emp(user), dto);
  }

  // ---- my requests ----
  @Get('leave/mine')
  myLeave(@CurrentUser() user: AuthUser) {
    return this.requests.myLeave(this.emp(user));
  }

  @Get('sick/mine')
  mySick(@CurrentUser() user: AuthUser) {
    return this.requests.mySick(this.emp(user));
  }

  // ---- inbox (combined to-approve) ----
  // Only items where it is THIS user's turn now (actionable) are returned:
  // a chain approver sees a leave request only once it reaches their step.
  @Get('inbox')
  async inbox(@CurrentUser() user: AuthUser) {
    const [leave, sick] = await Promise.all([
      this.requests.leaveToApprove(user.userId),
      this.requests.sickToApprove(user.userId),
    ]);
    return [...leave, ...sick]
      .filter((x: any) => x.actionable === true)
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  // ---- decide ----
  @Patch('leave/:id/decide')
  decideLeave(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDto,
  ) {
    return this.requests.decideLeave(user.userId, id, dto.approve, dto.comment);
  }

  @Patch('sick/:id/decide')
  decideSick(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDto,
  ) {
    return this.requests.decideSick(user.userId, id, dto.approve, dto.comment);
  }

  private emp(user: AuthUser): string {
    if (!user.employeeId) {
      throw new ForbiddenException('common.errors.employee_not_found');
    }
    return user.employeeId;
  }
}
