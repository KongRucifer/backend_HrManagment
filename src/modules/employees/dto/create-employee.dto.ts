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

  /**
   * Email for the NEW login account (required when createAccount is true and no
   * existingUserId is given). Employees themselves no longer store an email —
   * it lives on auth.users only.
   */
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

  @ApiPropertyOptional({ description: 'Position id (from the positions table)' })
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional({ example: '1998-05-20', description: 'Date of birth' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({
    example: '2027-01-31',
    description: 'Contract end date. Omit / null for open-ended employment.',
  })
  @IsOptional()
  @IsDateString()
  contractEndDate?: string;

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

  @ApiPropertyOptional({ description: 'Login username (defaults to employeeCode)' })
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

  @ApiPropertyOptional({
    description:
      'Link this already-existing account to the new employee instead of ' +
      'creating one. When set, username/password/role are ignored.',
  })
  @IsOptional()
  @IsUUID()
  existingUserId?: string;
}
