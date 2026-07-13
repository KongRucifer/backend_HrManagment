import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CheckOutDto {
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
}
