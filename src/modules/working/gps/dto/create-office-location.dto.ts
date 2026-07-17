import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateOfficeLocationDto {
  @ApiProperty({ example: 'Head Office' })
  @IsString()
  name: string;

  @ApiProperty({ example: 17.9757 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: 102.6331 })
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ example: 100, default: 100 })
  @IsOptional()
  @IsInt()
  @Min(10)
  radiusMeters?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
