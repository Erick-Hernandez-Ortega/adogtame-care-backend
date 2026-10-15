import { ConsoleLogger, INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { DatabaseService } from './database.service';

async function checkDatabaseConnection(): Promise<void> {
    let applicationContext: INestApplicationContext | undefined;
    const logger: Logger = new Logger('DatabaseCheck');

    try {
        applicationContext = await NestFactory.createApplicationContext(AppModule, {
            abortOnError: false,
            logger: new ConsoleLogger({ json: true }),
        });

        const databaseService: DatabaseService = applicationContext.get(DatabaseService);

        await databaseService.checkConnection();
        logger.log({ event: 'database_connection_succeeded' });
    } catch {
        logger.error({ event: 'database_connection_failed' });
        process.exitCode = 1;
    } finally {
        await applicationContext?.close();
    }
}

void checkDatabaseConnection();
