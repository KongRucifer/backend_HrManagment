import { Module } from '@nestjs/common';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

/**
 * FUTURE FEATURE — Recruitment / job openings (ເປີດສະໝັກຮັບພະນັກງານ).
 *
 * Scaffold only. Build out job postings, applicants, and hiring stages here,
 * keeping the feature self-contained next to `working`.
 */
@Module({
  controllers: [RecruitmentController],
  providers: [RecruitmentService],
})
export class RecruitmentModule {}
