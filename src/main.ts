import 'reflect-metadata';
import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { TransformInterceptor } from './shared/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.use(cookieParser());

  // Allow the React admin (credentials/cookies) and Flutter app to call the API.
  const corsOrigins = config.get<string[]>('cors.origins') || [];
  app.enableCors({
    origin: (origin, callback) => {
      // Allow same-origin/no-origin (curl, mobile) and whitelisted browser origins.
      if (!origin || corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger API docs at /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('HR_App API')
    .setDescription('Employee check-in/check-out backend')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('port') || 3000;
  await app.listen(port,'0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 HR_App backend running on http://localhost:${port}/api`);
  // eslint-disable-next-line no-console
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
