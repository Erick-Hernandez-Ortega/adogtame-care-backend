import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import { EnvironmentVariables } from '../config/environment.validation';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly client: Sql;
  readonly connection: PostgresJsDatabase;

  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    const databaseUrl: string = configService.getOrThrow('DATABASE_URL', {
      infer: true,
    });

    this.client = postgres(databaseUrl);
    this.connection = drizzle(this.client);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.end();
  }
}
