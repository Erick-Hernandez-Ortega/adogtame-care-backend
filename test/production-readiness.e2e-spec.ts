import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';

describe('Production readiness (e2e)', () => {
    let application: INestApplication<App>;
    let databaseService: DatabaseService;

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = moduleFixture.createNestApplication();
        application.useLogger(false);
        databaseService = application.get(DatabaseService);
        await application.init();
    });

    afterEach(async () => {
        await application.close();
    });

    it('checks the real database without authentication or pet data', async () => {
        await request(application.getHttpServer())
            .get('/health')
            .expect(200)
            .expect({ status: 'ok' });
    });

    it('returns a generic unavailable response when the database pool is closed', async () => {
        await databaseService.checkConnection();
        await databaseService.onApplicationShutdown();

        await request(application.getHttpServer())
            .get('/health')
            .expect(503)
            .expect({ code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' });
    });

    it('keeps the existing welcome route', async () => {
        await request(application.getHttpServer()).get('/').expect(200).expect('Hello World!');
    });
});
