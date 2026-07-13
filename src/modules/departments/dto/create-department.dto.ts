import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'IT Department' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;
}
