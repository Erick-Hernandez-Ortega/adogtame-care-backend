import { CareModule } from './care/infrastructure/care.module';
import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { rateLimitingOptions } from './infrastructure/http/rate-limiting';
import { APP_GUARD, Reflector, APP_FILTER } from '@nestjs/core';
import { AuthenticatedJsonRequestExceptionFilter } from './infrastructure/http/authenticated-json-request-exception.filter';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnvironment } from './infrastructure/config/environment.validation';
import { DatabaseModule } from './infrastructure/database/database.module';
import { HealthModule } from './health/infrastructure/health.module';
import { IdentityModule } from './identity/infrastructure/identity.module';
import { PetManagementModule } from './pet-management/infrastructure/pet-management.module';
import { HealthCheckController } from './infrastructure/http/health-check.controller';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
            validate: validateEnvironment,
        }),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService, Reflector],
            useFactory: rateLimitingOptions,
        }),
        DatabaseModule,
        IdentityModule,
        PetManagementModule,
        HealthModule,
        CareModule,
    ],
    controllers: [AppController, HealthCheckController],
    providers: [
        AppService,
        ThrottlerGuard,
        { provide: APP_GUARD, useExisting: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AuthenticatedJsonRequestExceptionFilter },
    ],
})
export class AppModule {}
