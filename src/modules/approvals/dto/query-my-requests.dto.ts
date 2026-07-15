import { ApiPropertyOptional } from '@nestjs/swagger';
import { RequestStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

/** The employee's own leave + emergency requests, as one paged list. */
export class QueryMyRequestsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: RequestStatus, description: 'Omit for all' })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;
}
