import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { QueryMyRequestsDto } from './dto/query-my-requests.dto';
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

  /**
   * Who will decide it. Omitted only when the pool holds nobody but the
   * requester — the service re-checks that rather than trusting the client.
   */
  @IsOptional()
  @IsUUID()
  approverUserId?: string;

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
  /**
   * Read-only leave approval chain (who will approve — employee can't choose).
   *
   * The caller is filtered out: they are about to request the leave, and their
   * own step is auto-approved when reached, so listing themselves as one of
   * their reviewers would be a lie. The admin's chain screen reads the
   * unfiltered list from /approvals/leave-chain instead.
   */
  @Get('leave-chain')
  async leaveChain(@CurrentUser() user: AuthUser) {
    const chain = await this.config.getChain();
    return chain.filter((c: any) => c.approverUserId !== user.userId);
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

  /**
   * The pool the employee picks ONE approver from — minus themselves, for the
   * same reason as the chain. An empty result is meaningful, not an error: it
   * means nobody else can decide, and the request auto-approves on creation.
   */
  @Get('emergency-approvers')
  async emergencyApprovers(@CurrentUser() user: AuthUser) {
    const pool = await this.config.getEmergencyPool();
    return pool.filter((p: any) => p.approverUserId !== user.userId);
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
  /**
   * Leave + emergency merged into one paged list (newest first), optionally
   * filtered by status. Replaces fetching both /mine lists and merging on the
   * client, which loaded every request the employee had ever made.
   */
  @Get('mine')
  myRequests(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryMyRequestsDto,
  ) {
    return this.requests.myRequests(this.emp(user), query);
  }

  /**
   * Whether to show the approvals area. True when the user is in the live
   * chain/pool OR still holds pending work (the chain is snapshotted per
   * request, so those two can diverge).
   */
  @Get('approver-status')
  approverStatus(@CurrentUser() user: AuthUser) {
    return this.requests.approverStatus(user.userId);
  }

  @Get('leave/mine')
  myLeave(@CurrentUser() user: AuthUser) {
    return this.requests.myLeave(this.emp(user));
  }

  @Get('emergency/mine')
  myEmergency(@CurrentUser() user: AuthUser) {
    return this.requests.myEmergency(this.emp(user));
  }

  // ---- fetch one (deep-link from a notification, which only carries refId) ----
  // Declared after "leave/mine" so the literal wins over the :id param.
  @Get('leave/:id')
  findLeave(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.findLeaveById(user.userId, user.employeeId, id);
  }

  @Get('emergency/:id')
  findEmergency(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.findEmergencyById(user.userId, user.employeeId, id);
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
