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

    private isReadinessProbeRunning: boolean = false;

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

    async checkReadiness(): Promise<void> {
        if (this.isReadinessProbeRunning) {
            throw new Error('Readiness probe is already running');
        }

        this.isReadinessProbeRunning = true;
        const probe = this.client.begin(async (transaction): Promise<void> => {
            await transaction`SET LOCAL statement_timeout = '1000ms'`;
            await transaction`SELECT 1`;
        });

        // Retain the slot until the driver settles, including after a response deadline.
        void probe.then(
            (): void => {
                this.isReadinessProbeRunning = false;
            },
            (): void => {
                this.isReadinessProbeRunning = false;
            },
        );
        let timeout: ReturnType<typeof setTimeout> | undefined;

        try {
            await Promise.race([
                probe,
                new Promise<never>((_resolve, reject): void => {
                    timeout = setTimeout(
                        (): void => reject(new Error('Readiness probe timed out')),
                        1000,
                    );
                }),
            ]);
        } finally {
            clearTimeout(timeout);
        }
    }

    async checkConnection(): Promise<void> {
        await this.connection.execute(sql`SELECT 1`);
    }
}
