import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './infrastructure/config/environment.validation';

async function bootstrap(): Promise<void> {
  const application: INestApplication = await NestFactory.create(AppModule);
  const configService: ConfigService<EnvironmentVariables, true> =
    application.get(ConfigService);
  const port: number = configService.getOrThrow('PORT', { infer: true });

  application.enableShutdownHooks();
  await application.listen(port);
}

void bootstrap();
