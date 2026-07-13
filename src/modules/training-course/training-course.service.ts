import { Injectable } from '@nestjs/common';

@Injectable()
export class TrainingCourseService {
  // TODO: implement course CRUD, enrollment, etc.
  status() {
    return { feature: 'training-course', status: 'scaffold' };
  }
}
