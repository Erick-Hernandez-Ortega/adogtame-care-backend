import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthenticatedJsonRequestExceptionFilter } from './infrastructure/http/authenticated-json-request-exception.filter';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnvironment } from './infrastructure/config/environment.validation';
import { DatabaseModule } from './infrastructure/database/database.module';
import { HealthModule } from './health/infrastructure/health.module';
import { IdentityModule } from './identity/infrastructure/identity.module';
import { PetManagementModule } from './pet-management/infrastructure/pet-management.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    DatabaseModule,
    IdentityModule,
    PetManagementModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AuthenticatedJsonRequestExceptionFilter },
  ],
})
export class AppModule {}
