import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Min } from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CreateScheduleDto {
  @ApiProperty({ example: 'Morning Shift' })
  @IsString()
  name: string;

  @ApiProperty({ example: '08:00', description: 'HH:mm or HH:mm:ss' })
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm or HH:mm:ss' })
  startTime: string;

  @ApiProperty({ example: '17:00', description: 'HH:mm or HH:mm:ss' })
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm or HH:mm:ss' })
  endTime: string;

  @ApiPropertyOptional({ example: 15, default: 0 })
  @IsInt()
  @Min(0)
  lateAfterMinutes: number = 0;
}
