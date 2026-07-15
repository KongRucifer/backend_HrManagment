import { IsString, Length, MinLength } from 'class-validator';

export class ConfirmOtpDto {
  /** The 6-digit code emailed to the user. */
  @IsString()
  @Length(6, 6)
  code: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
