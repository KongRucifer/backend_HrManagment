import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * The device reports the WiFi it is currently connected to. The SERVER
 * decides whether it is valid (never trust the client's own verdict).
 */
export class CheckInDto {
  @ApiProperty({ example: 'LTS_OFFICE', description: 'Connected WiFi SSID' })
  @IsString()
  ssid: string;

  @ApiProperty({
    example: 'a4:2b:8c:11:22:33',
    description: 'Connected WiFi BSSID (router MAC)',
  })
  @IsString()
  bssid: string;

  @ApiPropertyOptional({ example: '17.9757,102.6331', description: 'lat,lng' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
