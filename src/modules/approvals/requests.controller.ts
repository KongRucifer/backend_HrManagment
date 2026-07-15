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
  Matches,
  MinLength,
} from 'class-validator';
import {
  AuthUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { ConfigService } from './config.service';
import { RequestsService } from './requests.service';

class CreateLeaveDto {
  @IsUUID()
  leaveTypeId: string;

  @IsString()
  @MinLength(1)
  reason: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
class CreateEmergencyDto {
  @IsUUID()
  emergencyTypeId: string;

  @IsUUID()
  approverUserId: string;

  @IsString()
  @MinLength(1)
  reason: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  /** Optional "HH:mm" window — send BOTH or neither (whole-day request). */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:mm' })
  endTime?: string;
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

  /** Active leave types (for the employee's request form). */
  @Get('leave-types')
  leaveTypes() {
    return this.config.listActiveLeaveTypes();
  }

  /** Active emergency (ສຸກເສີນ) types (for the employee's request form). */
  @Get('emergency-types')
  emergencyTypes() {
    return this.config.listActiveEmergencyTypes();
  }

  @Get('emergency-approvers')
  emergencyApprovers() {
    return this.config.getEmergencyPool();
  }

  // ---- create ----
  @Post('leave')
  createLeave(@CurrentUser() user: AuthUser, @Body() dto: CreateLeaveDto) {
    return this.requests.createLeave(this.emp(user), dto);
  }

  @Post('emergency')
  createEmergency(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEmergencyDto,
  ) {
    return this.requests.createEmergency(this.emp(user), dto);
  }

  // ---- my requests ----
  @Get('leave/mine')
  myLeave(@CurrentUser() user: AuthUser) {
    return this.requests.myLeave(this.emp(user));
  }

  @Get('emergency/mine')
  myEmergency(@CurrentUser() user: AuthUser) {
    return this.requests.myEmergency(this.emp(user));
  }

  // ---- inbox (combined to-approve) ----
  // Only items where it is THIS user's turn now (actionable) are returned:
  // a chain approver sees a leave request only once it reaches their step.
  @Get('inbox')
  async inbox(@CurrentUser() user: AuthUser) {
    const [leave, emergency] = await Promise.all([
      this.requests.leaveToApprove(user.userId),
      this.requests.emergencyToApprove(user.userId),
    ]);
    return [...leave, ...emergency]
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

  @Patch('emergency/:id/decide')
  decideEmergency(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDto,
  ) {
    return this.requests.decideEmergency(
      user.userId,
      id,
      dto.approve,
      dto.comment,
    );
  }

  private emp(user: AuthUser): string {
    if (!user.employeeId) {
      throw new ForbiddenException('common.errors.employee_not_found');
    }
    return user.employeeId;
  }
}
