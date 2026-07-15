import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationDto } from '../../../../shared/dto/pagination.dto';
import { AttendanceStatus } from '@prisma/client';

export class QueryAttendanceDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by employee (admin/manager only)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Search by employee name / code (admin)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional({
    enum: ['leave', 'emergency'],
    description:
      'Filter to days covered by an approved request. Matches on the FK, NOT ' +
      'on status — a partial-day emergency keeps status=on_time, so ' +
      'status=emergency would miss it.',
  })
  @IsOptional()
  @IsIn(['leave', 'emergency'])
  kind?: 'leave' | 'emergency';

  @ApiPropertyOptional({ description: 'Only days checked out before end_time' })
  @IsOptional()
  // Read the RAW value off `obj`: main.ts enables enableImplicitConversion,
  // which would run Boolean('false') === true and silently invert this.
  @Transform(({ obj }) => {
    const raw = obj?.leftEarly;
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw;
  })
  @IsBoolean()
  leftEarly?: boolean;
}
