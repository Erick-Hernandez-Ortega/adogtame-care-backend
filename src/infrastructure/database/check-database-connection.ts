import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../app.module';
import { DatabaseService } from './database.service';

async function checkDatabaseConnection(): Promise<void> {
  let applicationContext: INestApplicationContext | undefined;

  try {
    applicationContext = await NestFactory.createApplicationContext(AppModule);

    const databaseService: DatabaseService =
      applicationContext.get(DatabaseService);

    await databaseService.connection.execute(sql`SELECT 1`);
    console.log('Database connection successful.');
  } catch (error: unknown) {
    const message: string =
      error instanceof Error ? error.message : String(error);

    console.error(`Database connection failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await applicationContext?.close();
  }
}

void checkDatabaseConnection();
