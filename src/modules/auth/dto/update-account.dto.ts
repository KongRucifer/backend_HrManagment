import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

/** Change the logged-in user's own username (the login identifier). */
export class UpdateUsernameDto {
  @ApiProperty({ example: 'somchai' })
  @IsString()
  @MinLength(3)
  username: string;
}

/** Step 1 of an email change — the code is sent to this NEW address. */
export class RequestEmailOtpDto {
  @ApiProperty({ example: 'new@company.la' })
  @IsEmail()
  newEmail: string;
}

/** Step 2 of an email change — confirms the code mailed to the new address. */
export class ConfirmEmailOtpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;
}
