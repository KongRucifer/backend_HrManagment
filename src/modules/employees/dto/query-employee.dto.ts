import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../shared/dto/pagination.dto';
import { EmployeeStatus } from '@prisma/client';

export class QueryEmployeeDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ description: 'Search by name, code or account username' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '"true" shows the soft-deleted bin' })
  @IsOptional()
  @IsString()
  deleted?: string;
}
