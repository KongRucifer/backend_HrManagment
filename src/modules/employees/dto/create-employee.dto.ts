import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { Role } from '@prisma/client';

export class CreateEmployeeDto {
  @ApiPropertyOptional({
    example: 'EMP00001',
    description: 'Auto-generated (EMP#####) when omitted.',
  })
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @ApiProperty({ example: 'Somchai' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Vongsa' })
  @IsString()
  lastName: string;

  @ApiPropertyOptional({ example: 'somchai@company.la' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '02055512345' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'Developer' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ description: 'Position id (from the positions table)' })
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional({ example: '1998-05-20', description: 'Date of birth' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ description: 'Assigned work shift id' })
  @IsOptional()
  @IsUUID()
  workScheduleId?: string;

  // ----- Optional: create a login account together with the employee -----
  @ApiPropertyOptional({
    description: 'If true, also creates a login account for this employee',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  createAccount?: boolean;

  @ApiPropertyOptional({
    description: 'Login email (defaults to the employee email). Login is by email.',
  })
  @IsOptional()
  @IsEmail()
  loginEmail?: string;

  @ApiPropertyOptional({ description: 'Optional display handle (defaults to employeeCode)' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @ApiPropertyOptional({ description: 'Login password (defaults to employeeCode)' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional({ enum: Role, default: Role.employee })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
