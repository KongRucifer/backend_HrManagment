import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/**
 * Account fields (email/username/password/role) are not updatable here —
 * they live on the login account; manage them via /users.
 */
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, [
    'createAccount',
    'email',
    'username',
    'password',
    'role',
    'existingUserId',
  ] as const),
) {}
