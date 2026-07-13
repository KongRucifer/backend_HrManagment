import { Injectable } from '@nestjs/common';

@Injectable()
export class RecruitmentService {
  // TODO: implement job postings, applications, hiring pipeline.
  status() {
    return { feature: 'recruitment', status: 'scaffold' };
  }
}
