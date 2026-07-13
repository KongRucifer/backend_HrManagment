import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Somchai' })
  @IsString()
  @MinLength(1)
  firstName: string;

  @ApiProperty({ example: 'Vongsa' })
  @IsString()
  @MinLength(1)
  lastName: string;

  @ApiProperty({ example: 'somchai@company.la' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'somchai' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @ApiPropertyOptional({ example: '02055512345' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '1998-05-20' })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiProperty({ example: 'secret1234', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
