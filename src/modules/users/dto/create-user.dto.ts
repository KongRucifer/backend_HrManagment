import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  /** Used for notifications / password-reset OTP (not for login). */
  @ApiProperty({ example: 'somchai@company.la' })
  @IsEmail()
  email: string;

  /** The login identifier — required and unique. */
  @ApiProperty({ example: 'somchai', description: 'Login username' })
  @IsString()
  @MinLength(3)
  username: string;

  @ApiProperty({ example: 'secret123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ enum: Role, example: Role.employee })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({ description: 'Linked employee id (public.employees)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
