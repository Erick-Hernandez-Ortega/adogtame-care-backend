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
