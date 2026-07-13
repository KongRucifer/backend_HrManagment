import { PartialType } from '@nestjs/swagger';
import { CreateWifiDto } from './create-wifi.dto';

export class UpdateWifiDto extends PartialType(CreateWifiDto) {}
