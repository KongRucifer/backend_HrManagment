import { Module } from '@nestjs/common';
import { TrainingCourseController } from './training-course.controller';
import { TrainingCourseService } from './training-course.service';

/**
 * FUTURE FEATURE — Training courses (ຄອສຝຶກອົບຮົມ).
 *
 * This is a scaffold showing the pattern: a self-contained feature module
 * that sits next to `working`. When you build it out, add:
 *   entities/  dto/  and register entities via TypeOrmModule.forFeature([...]).
 */
@Module({
  controllers: [TrainingCourseController],
  providers: [TrainingCourseService],
})
export class TrainingCourseModule {}
