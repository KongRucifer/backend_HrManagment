import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TrainingCourseService } from './training-course.service';

@ApiTags('training-course')
@ApiBearerAuth()
@Controller('training-courses')
export class TrainingCourseController {
  constructor(private readonly service: TrainingCourseService) {}

  @Get('status')
  status() {
    return this.service.status();
  }
}
