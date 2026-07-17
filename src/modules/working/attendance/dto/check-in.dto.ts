import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

/**
 * A check-in is verified server-side by GPS: the client sends lat + lng and the
 * server decides whether they fall inside an office geofence. (WiFi checking has
 * been retired — both the web and mobile apps send coordinates now.) The fields
 * are optional at the DTO layer so a granted work-from-home day can check in
 * without a fix; the service rejects a normal check-in that carries no location.
 */
export class CheckInDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
