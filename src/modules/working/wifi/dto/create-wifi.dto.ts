import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateWifiDto {
  @ApiProperty({ example: 'Head Office - Floor 1' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'LTS_OFFICE' })
  @IsString()
  ssid: string;

  @ApiProperty({ example: 'a4:2b:8c:11:22:33', description: 'Router MAC address' })
  @IsString()
  bssid: string;

  @ApiPropertyOptional({ example: 'OFFICE-2026' })
  @IsOptional()
  @IsString()
  wifiCode?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
