import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/** Account-creation fields are not updatable here; manage logins via /users. */
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, [
    'createAccount',
    'loginEmail',
    'username',
    'password',
    'role',
  ] as const),
) {}
