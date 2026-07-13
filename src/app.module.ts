import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import * as path from 'path';
import { AppController } from './app.controller';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuthModule } from './modules/auth/auth.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { PositionsModule } from './modules/positions/positions.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { SeedModule } from './modules/seed/seed.module';
import { TrainingCourseModule } from './modules/training-course/training-course.module';
import { UsersModule } from './modules/users/users.module';
import { WorkingModule } from './modules/working/working.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { RolesGuard } from './shared/guards/roles.guard';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    I18nModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        fallbackLanguage: config.get<string>('defaultLang') || 'lo',
        loaderOptions: {
          path: path.join(__dirname, '/i18n/'),
          watch: true,
        },
      }),
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        AcceptLanguageResolver,
        new HeaderResolver(['x-lang']),
      ],
    }),
    SharedModule,

    // Core modules
    AuthModule,
    UsersModule,
    EmployeesModule,
    DepartmentsModule,
    PositionsModule,

    // Features (sit next to each other under src/modules/)
    WorkingModule,
    NotificationsModule,
    ApprovalsModule,
    TrainingCourseModule,
    RecruitmentModule,

    // Startup seeding
    SeedModule,
  ],
  controllers: [AppController],
  providers: [
    // Global auth: every route needs a JWT unless marked @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global RBAC: enforces @Roles(...)
    { provide: APP_GUARD, useClass: RolesGuard },
    // Global error shape + i18n message translation
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
