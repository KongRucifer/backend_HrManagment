import { Body, Controller, Get, Patch, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  AuthUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmOtpDto } from './dto/confirm-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import {
  ConfirmEmailOtpDto,
  RequestEmailOtpDto,
  UpdateUsernameDto,
} from './dto/update-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    this.setAuthCookie(res, result.accessToken);
    // Tokens also returned for non-browser clients (mobile app / API tools).
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);
    this.setAuthCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  // Public availability check used by the mobile sign-up form (live check).
  @Public()
  @Get('availability')
  checkAvailability(
    @Query('username') username?: string,
    @Query('email') email?: string,
  ) {
    return this.authService.checkAvailability(username, email);
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refresh(dto.refreshToken);
    this.setAuthCookie(res, result.accessToken);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @ApiBearerAuth()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(this.config.get<string>('cookie.name') || 'access_token', {
      path: '/',
    });
    return { success: true };
  }

  @ApiBearerAuth()
  /** Fresh profile from the DB (the JWT payload is stale after email/username edits). */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.userId);
  }

  @ApiBearerAuth()
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.employeeId, dto, user.userId);
  }

  @ApiBearerAuth()
  @Patch('password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  /** Step 1: email a one-time code to the logged-in user (for password change). */
  @ApiBearerAuth()
  @Post('password/request-otp')
  requestPasswordOtp(@CurrentUser() user: AuthUser) {
    return this.authService.requestPasswordOtp(user.userId);
  }

  /** Step 2: verify the code and set the new password. */
  @ApiBearerAuth()
  @Post('password/confirm-otp')
  confirmPasswordOtp(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmOtpDto,
  ) {
    return this.authService.confirmPasswordOtp(
      user.userId,
      dto.code,
      dto.newPassword,
    );
  }

  /** Change your own username (the login identifier). */
  @ApiBearerAuth()
  @Patch('username')
  updateUsername(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateUsernameDto,
  ) {
    return this.authService.updateUsername(user.userId, dto.username);
  }

  /** Step 1 of an email change: mail a code to the NEW address. */
  @ApiBearerAuth()
  @Post('email/request-otp')
  requestEmailOtp(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestEmailOtpDto,
  ) {
    return this.authService.requestEmailOtp(user.userId, dto.newEmail);
  }

  /** Step 2: verify the code and switch to the new address. */
  @ApiBearerAuth()
  @Post('email/confirm-otp')
  confirmEmailOtp(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmEmailOtpDto,
  ) {
    return this.authService.confirmEmailOtp(user.userId, dto.code);
  }

  private setAuthCookie(res: Response, token: string) {
    res.cookie(this.config.get<string>('cookie.name') || 'access_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<boolean>('cookie.secure') ?? false,
      maxAge: this.config.get<number>('cookie.maxAgeMs') ?? 86_400_000,
      path: '/',
    });
  }
}
