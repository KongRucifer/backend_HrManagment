import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

/** Step 1 of a public password reset: the account email to send the OTP to. */
export class ForgotPasswordRequestDto {
  @ApiProperty({ example: 'someone@company.la' })
  @IsEmail()
  email: string;
}

/** Step 2: the emailed code + the new password to set. */
export class ForgotPasswordConfirmDto {
  @ApiProperty({ example: 'someone@company.la' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
