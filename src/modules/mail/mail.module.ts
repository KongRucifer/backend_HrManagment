import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Global so any module (e.g. auth) can inject MailService without re-importing. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
