import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/**
 * Range for the employee's own attendance summary. A free date range rather
 * than ?month=YYYY-MM so the same endpoint serves the month picker and any
 * custom range the detail page asks for.
 */
export class SummaryAttendanceDto {
  @ApiPropertyOptional({
    example: '2026-07-01',
    description: 'Defaults to the 1st of the current Vientiane month.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-07-31',
    description: 'Defaults to the last day of the current Vientiane month.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
