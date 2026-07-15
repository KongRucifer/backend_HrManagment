import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../shared/dto/pagination.dto';

/** Paged notification list, optionally narrowed to read / unread. */
export class QueryNotificationDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'true = read only, false = unread only, omitted = all',
  })
  @IsOptional()
  // Read the RAW value off `obj`, not `value`. main.ts enables
  // `enableImplicitConversion`, which for a boolean-typed field runs
  // Boolean(raw) FIRST — and Boolean('false') is `true`, so ?isRead=false
  // would silently mean "read". Going back to the untouched string avoids it.
  @Transform(({ obj }) => {
    const raw = obj?.isRead;
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw; // anything else falls through to @IsBoolean -> 400
  })
  @IsBoolean()
  isRead?: boolean;
}
