import { configureSecurityHeaders } from './infrastructure/http/configure-security-headers';
import { ConsoleLogger, INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './infrastructure/config/environment.validation';
import { configureOpenApi } from './infrastructure/http/configure-openapi';

async function bootstrap(): Promise<void> {
    const application: INestApplication = await NestFactory.create(AppModule, {
        abortOnError: false,
        logger: new ConsoleLogger({ json: true }),
    });

    try {
        const configService: ConfigService<EnvironmentVariables, true> =
            application.get(ConfigService);
        const port: number = configService.getOrThrow('PORT', { infer: true });

        configureSecurityHeaders(application);
        configureOpenApi(application);
        application.enableShutdownHooks();

        await application.listen(port);
        new Logger('Bootstrap').log({ event: 'application_started', port });
    } catch {
        await application.close();

        throw new Error('Application failed to start');
    }
}

void bootstrap().catch((): void => {
    new Logger('Bootstrap').error({ event: 'application_start_failed' });
    process.exitCode = 1;
});
