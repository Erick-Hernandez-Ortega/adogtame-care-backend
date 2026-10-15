import { sql } from 'drizzle-orm';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from '../src/infrastructure/config/environment.validation';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';

describe('Production database lifecycle (integration)', () => {
    let application: INestApplicationContext;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
                DatabaseModule,
            ],
        }).compile();

        application = await moduleFixture.init();
        application.useLogger(false);
    });

    afterEach(async () => {
        await application.close();
    });

    it('probes PostgreSQL and releases the readiness slot after completion or failure', async () => {
        const databaseService: DatabaseService = application.get(DatabaseService);

        await databaseService.checkReadiness();
        await databaseService.checkReadiness();
        await application.close();
        await expect(databaseService.checkReadiness()).rejects.toBeDefined();
        await expect(databaseService.checkReadiness()).rejects.not.toThrow('already running');
    });

    it('bounds readiness waiting for a saturated pool and retains one pending probe', async () => {
        const databaseService: DatabaseService = application.get(DatabaseService);

        await databaseService.checkConnection();
        let releaseTransactions: () => void = (): void => {};
        const barrier: Promise<void> = new Promise((resolve): void => {
            releaseTransactions = resolve;
        });
        const acquired: Promise<void>[] = [];
        const transactions: Promise<void>[] = [];

        for (let connectionNumber: number = 0; connectionNumber < 10; connectionNumber += 1) {
            let signalAcquired: () => void = (): void => {};

            acquired.push(
                new Promise((resolve): void => {
                    signalAcquired = resolve;
                }),
            );
            transactions.push(
                databaseService.connection.transaction(async (transaction): Promise<void> => {
                    await transaction.execute(sql`SELECT 1`);
                    signalAcquired();
                    await barrier;
                }),
            );
        }

        try {
            await Promise.all(acquired);
            const probe: Promise<void> = databaseService.checkReadiness();

            await expect(databaseService.checkReadiness()).rejects.toThrow('already running');
            await expect(probe).rejects.toThrow('Readiness probe timed out');
            await expect(databaseService.checkReadiness()).rejects.toThrow('already running');
        } finally {
            releaseTransactions();
            await Promise.all(transactions);
        }
    });

    it('closes an unused pool when the application context closes', async () => {
        const databaseService: DatabaseService = application.get(DatabaseService);

        await application.close();

        await expect(databaseService.checkConnection()).rejects.toMatchObject({
            cause: { code: 'CONNECTION_ENDED' },
        });
    });

    it('closes an opened PostgreSQL pool when the application context closes', async () => {
        const databaseService: DatabaseService = application.get(DatabaseService);

        await databaseService.checkConnection();
        await application.close();

        await expect(databaseService.checkConnection()).rejects.toMatchObject({
            cause: { code: 'CONNECTION_ENDED' },
        });
    });
});
