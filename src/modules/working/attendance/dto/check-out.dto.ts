import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

/** Same GPS verification as check-in (or skipped on a work-from-home day). */
export class CheckOutDto {
  @ApiPropertyOptional({ example: 17.9757, description: 'GPS latitude' })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 102.6331, description: 'GPS longitude' })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ example: '17.9757,102.6331', description: 'lat,lng' })
  @IsOptional()
  @IsString()
  location?: string;
}
