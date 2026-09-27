import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { healthWeightRecords } from '../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface AccountFixture {
  id: string;
  token: string;
}

interface HistoryResponse {
  items: {
    id: string;
    weightKg: string;
    measuredDate: string;
    recordedByAccountId: string;
  }[];
  nextCursor: string | null;
}

describe('GET /pets/:petId/health/weight-records (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let owner: AccountFixture;
  let collaborator: AccountFixture;
  let outsider: AccountFixture;
  let petId: string;

  async function account(label: string): Promise<AccountFixture> {
    const email = `${label}-${randomUUID()}@example.com`;
    const password = 'a secure password';
    const registration = await request(application.getHttpServer())
      .post('/accounts')
      .send({ email, password })
      .expect(201);
    const login = await request(application.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return {
      id: (registration.body as { id: string }).id,
      token: (login.body as { accessToken: string }).accessToken,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = moduleFixture.createNestApplication();
    await application.init();
    database = application.get(DatabaseService);
    owner = await account('history-owner');
    collaborator = await account('history-collaborator');
    outsider = await account('history-outsider');
  });

  afterAll(async () => {
    for (const fixture of [owner, collaborator, outsider]) {
      await database.connection
        .delete(accounts)
        .where(eq(accounts.id, fixture.id));
    }
    await application.close();
  });

  beforeEach(async () => {
    const response = await request(application.getHttpServer())
      .post('/pets')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        name: 'Luna',
        species: 'DOG',
        breed: { name: 'Mixed', kind: 'CUSTOM' },
        sex: 'FEMALE',
        birthInformation: { date: '2020-01-01', accuracy: 'EXACT' },
      })
      .expect(201);
    petId = (response.body as { id: string }).id;
    await database.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId,
      accountId: collaborator.id,
      role: 'COLLABORATOR',
      status: 'ACTIVE',
    });
  });

  afterEach(async () => {
    await database.connection
      .delete(healthWeightRecords)
      .where(eq(healthWeightRecords.petId, petId));
    await database.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, petId));
    await database.connection.delete(pets).where(eq(pets.id, petId));
  });

  function path(id: string = petId): string {
    return `/pets/${id}/health/weight-records`;
  }

  async function record(
    measuredDate: string,
    weightKg = '12.34',
    createdAt?: string,
  ): Promise<string> {
    const response = await request(application.getHttpServer())
      .post(path())
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ measuredDate, weightKg })
      .expect(201);
    const id: string = (response.body as { id: string }).id;
    if (createdAt !== undefined) {
      await database.connection.execute(
        sql`UPDATE health_weight_records SET created_at = ${createdAt}::timestamptz WHERE id = ${id}::uuid`,
      );
    }
    return id;
  }

  it('returns empty history for owner and collaborator, including an archived pet', async () => {
    for (const fixture of [owner, collaborator]) {
      const response = await request(application.getHttpServer())
        .get(path())
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(200);
      expect(response.body).toEqual({ items: [], nextCursor: null });
    }
    const recordId: string = await record('2026-09-26');
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, petId));
    for (const fixture of [owner, collaborator]) {
      const response = await request(application.getHttpServer())
        .get(path())
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(200);
      expect(
        (response.body as HistoryResponse).items.map((item) => item.id),
      ).toEqual([recordId]);
    }
  });

  it('orders records and paginates through tied dates without exposing createdAt', async () => {
    const olderId = await record('2026-09-25', '10');
    const firstId = await record(
      '2026-09-26',
      '00012.3400',
      '2026-09-26T12:00:00.123457Z',
    );
    const tiedId = await record(
      '2026-09-26',
      '12.3456',
      '2026-09-26T12:00:00.123456Z',
    );
    const firstResponse = await request(application.getHttpServer())
      .get(path())
      .query({ limit: '1' })
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(200);
    const firstPage: HistoryResponse = firstResponse.body as HistoryResponse;
    expect(firstPage.items).toEqual([
      {
        id: firstId,
        weightKg: '12.34',
        measuredDate: '2026-09-26',
        recordedByAccountId: owner.id,
      },
    ]);
    expect(typeof firstPage.nextCursor).toBe('string');

    const secondResponse = await request(application.getHttpServer())
      .get(path())
      .query({ limit: '1', cursor: firstPage.nextCursor })
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(200);
    const secondPage: HistoryResponse = secondResponse.body as HistoryResponse;
    expect(secondPage.items.map((item) => item.id)).toEqual([tiedId]);
    const lastResponse = await request(application.getHttpServer())
      .get(path())
      .query({ limit: '1', cursor: secondPage.nextCursor })
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(200);
    const lastPage: HistoryResponse = lastResponse.body as HistoryResponse;
    expect(lastPage.items.map((item) => item.id)).toEqual([olderId]);
    expect(lastPage.nextCursor).toBeNull();

    const defaultResponse = await request(application.getHttpServer())
      .get(path())
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(
      (defaultResponse.body as HistoryResponse).items.map((item) => item.id),
    ).toEqual([firstId, tiedId, olderId]);
  });

  it('defaults to 20 items and returns the remaining item through its cursor', async () => {
    await database.connection.insert(healthWeightRecords).values(
      Array.from({ length: 21 }, () => ({
        id: randomUUID(),
        petId,
        weightKg: '12.34',
        measuredDate: '2026-09-26',
        recordedByAccountId: owner.id,
      })),
    );
    const firstResponse = await request(application.getHttpServer())
      .get(path())
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const firstPage: HistoryResponse = firstResponse.body as HistoryResponse;
    expect(firstPage.items).toHaveLength(20);
    expect(typeof firstPage.nextCursor).toBe('string');
    const lastResponse = await request(application.getHttpServer())
      .get(path())
      .query({ cursor: firstPage.nextCursor })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const lastPage: HistoryResponse = lastResponse.body as HistoryResponse;
    expect(lastPage.items).toHaveLength(1);
    expect(lastPage.nextCursor).toBeNull();
    expect(
      new Set([...firstPage.items, ...lastPage.items].map((item) => item.id))
        .size,
    ).toBe(21);
  });

  it('returns the same PET_NOT_FOUND for inactive membership, outsider, and missing pet', async () => {
    await record('2026-09-26');
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.accountId, collaborator.id));
    for (const [fixture, requestedPath] of [
      [collaborator, path()],
      [outsider, path()],
      [owner, path(randomUUID())],
    ] as const) {
      const response = await request(application.getHttpServer())
        .get(requestedPath)
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(404);
      expect(response.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });
    }
  });

  it('requires JWT and validates path and strict query parameters', async () => {
    await request(application.getHttpServer()).get(path()).expect(401);
    const badPath = await request(application.getHttpServer())
      .get(path('bad-id'))
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);
    expect(badPath.body).toMatchObject({ code: 'INVALID_REQUEST' });
    for (const limit of ['0', '-1', '101', 'abc', '1.5', '01']) {
      const response = await request(application.getHttpServer())
        .get(path())
        .query({ limit })
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    }
    for (const query of [{ cursor: 'bad!' }, { extra: 'value' }]) {
      const response = await request(application.getHttpServer())
        .get(path())
        .query(query)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await request(application.getHttpServer())
      .get(path())
      .query({ limit: '100' })
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
  });
});
