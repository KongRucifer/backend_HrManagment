import { PartialType } from '@nestjs/swagger';
import { CreateOfficeLocationDto } from './create-office-location.dto';

export class UpdateOfficeLocationDto extends PartialType(
  CreateOfficeLocationDto,
) {}
