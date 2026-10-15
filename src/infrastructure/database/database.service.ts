import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { Sql } from 'postgres';
import { EnvironmentVariables } from '../config/environment.validation';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
    private readonly logger: Logger = new Logger(DatabaseService.name);

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
        this.logger.log({ event: 'database_pool_closed' });
    }

    async checkConnection(): Promise<void> {
        await this.connection.execute(sql`SELECT 1`);
    }
}
