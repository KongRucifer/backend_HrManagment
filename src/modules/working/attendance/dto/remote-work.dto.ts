import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Admin grant of a work-from-home day (GPS bypass) for one or more employees.
 * `date` defaults to today (Vientiane) when omitted.
 */
export class GrantRemoteWorkDto {
  @ApiProperty({ type: [String], description: 'Employee ids to grant WFH' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  employeeIds!: string[];

  @ApiPropertyOptional({ example: '2026-07-17', description: 'YYYY-MM-DD (default: today)' })
  @IsOptional()
  @IsDateString()
  date?: string;
}
