import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreatePositionDto {
  @ApiProperty({ example: 'Developer' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ description: 'Department this position belongs to' })
  @IsUUID()
  departmentId: string;
}
