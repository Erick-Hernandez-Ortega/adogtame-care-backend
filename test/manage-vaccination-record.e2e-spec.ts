import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { healthVaccinationRecords } from '../src/health/infrastructure/persistence/drizzle/health.schema';
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

describe('PATCH and DELETE pet vaccination records (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let owner: AccountFixture;
  let collaborator: AccountFixture;
  let outsider: AccountFixture;
  let petId: string;
  let otherPetId: string;
  let collaboratorMembershipId: string;

  async function createAccount(): Promise<AccountFixture> {
    const email: string = `${randomUUID()}@example.com`;
    const password: string = 'a secure password';
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
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = fixture.createNestApplication();
    await application.init();
    database = application.get(DatabaseService);
    owner = await createAccount();
    collaborator = await createAccount();
    outsider = await createAccount();
  });

  afterAll(async () => {
    for (const account of [owner, collaborator, outsider]) {
      await database.connection
        .delete(accounts)
        .where(eq(accounts.id, account.id));
    }
    await application.close();
  });

  beforeEach(async () => {
    petId = randomUUID();
    otherPetId = randomUUID();
    collaboratorMembershipId = randomUUID();
    await database.connection.insert(pets).values(
      [petId, otherPetId].map((id) => ({
        id,
        name: 'Vaccination pet',
        species: 'DOG' as const,
        breedName: 'Mixed',
        breedKind: 'CUSTOM' as const,
        sex: 'UNKNOWN' as const,
        birthDate: '2020-01-01',
        birthDateAccuracy: 'EXACT' as const,
        status: 'ACTIVE' as const,
      })),
    );
    await database.connection.insert(petMemberships).values([
      {
        id: randomUUID(),
        petId,
        accountId: owner.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      {
        id: collaboratorMembershipId,
        petId,
        accountId: collaborator.id,
        role: 'COLLABORATOR',
        status: 'ACTIVE',
      },
    ]);
  });

  afterEach(async () => {
    for (const id of [petId, otherPetId]) {
      await database.connection
        .delete(healthVaccinationRecords)
        .where(eq(healthVaccinationRecords.petId, id));
      await database.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, id));
      await database.connection.delete(pets).where(eq(pets.id, id));
    }
  });

  function path(recordId: string, id: string = petId): string {
    return `/pets/${id}/health/vaccination-records/${recordId}`;
  }

  async function createRecord(
    id: string = petId,
    account: AccountFixture = owner,
  ): Promise<string> {
    const response = await request(application.getHttpServer())
      .post(`/pets/${id}/health/vaccination-records`)
      .set('Authorization', `Bearer ${account.token}`)
      .send({
        vaccineName: 'Rabies',
        appliedDate: '2024-01-01',
        nextDueDate: '2025-01-01',
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it('patches each field, clears due date, and preserves original authorship', async () => {
    const recordId = await createRecord();
    const expected = {
      id: recordId,
      petId,
      recordedByAccountId: owner.id,
    };
    const name = await request(application.getHttpServer())
      .patch(path(recordId))
      .set('Authorization', `Bearer ${collaborator.token}`)
      .send({ vaccineName: '  Rabies Booster  ' })
      .expect(200);
    expect(name.body).toEqual({
      ...expected,
      vaccineName: 'Rabies Booster',
      appliedDate: '2024-01-01',
      nextDueDate: '2025-01-01',
    });
    const applied = await request(application.getHttpServer())
      .patch(path(recordId))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ appliedDate: '2024-02-01' })
      .expect(200);
    expect(applied.body).toMatchObject({ appliedDate: '2024-02-01' });
    const due = await request(application.getHttpServer())
      .patch(path(recordId))
      .set('Authorization', `Bearer ${collaborator.token}`)
      .send({ nextDueDate: '2026-01-01' })
      .expect(200);
    expect(due.body).toMatchObject({ nextDueDate: '2026-01-01' });
    const cleared = await request(application.getHttpServer())
      .patch(path(recordId))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nextDueDate: null })
      .expect(200);
    expect(cleared.body).toMatchObject({ nextDueDate: null });
    const combined = await request(application.getHttpServer())
      .patch(path(recordId))
      .set('Authorization', `Bearer ${collaborator.token}`)
      .send({
        vaccineName: 'Distemper',
        appliedDate: '2024-03-01',
        nextDueDate: '2025-03-01',
      })
      .expect(200);
    expect(combined.body).toEqual({
      ...expected,
      vaccineName: 'Distemper',
      appliedDate: '2024-03-01',
      nextDueDate: '2025-03-01',
    });
  });

  it('validates strict PATCH body and domain values', async () => {
    const recordId = await createRecord();
    const cases: [object, string][] = [
      [{}, 'INVALID_REQUEST'],
      [{ id: recordId }, 'INVALID_REQUEST'],
      [{ petId }, 'INVALID_REQUEST'],
      [{ recordedByAccountId: owner.id }, 'INVALID_REQUEST'],
      [{ createdAt: '2024-01-01' }, 'INVALID_REQUEST'],
      [{ updatedAt: '2024-01-01' }, 'INVALID_REQUEST'],
      [{ status: 'ACTIVE' }, 'INVALID_REQUEST'],
      [{ vaccineName: '' }, 'INVALID_VACCINE_NAME'],
      [{ vaccineName: 'x'.repeat(256) }, 'INVALID_VACCINE_NAME'],
      [{ appliedDate: '2024-02-30' }, 'INVALID_APPLIED_DATE'],
      [{ appliedDate: '9999-12-31' }, 'INVALID_APPLIED_DATE'],
      [{ nextDueDate: '2025-02-29' }, 'INVALID_NEXT_DUE_DATE'],
      [{ nextDueDate: '2023-12-31' }, 'INVALID_NEXT_DUE_DATE'],
      [
        { appliedDate: '2024-06-01', nextDueDate: '2024-03-01' },
        'INVALID_NEXT_DUE_DATE',
      ],
    ];
    for (const [body, code] of cases) {
      const response = await request(application.getHttpServer())
        .patch(path(recordId))
        .set('Authorization', `Bearer ${owner.token}`)
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({ code });
    }
    await request(application.getHttpServer())
      .patch(path(recordId))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ nextDueDate: '2024-03-01' })
      .expect(200);
    const invalidExistingDate = await request(application.getHttpServer())
      .patch(path(recordId))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ appliedDate: '2024-06-01' })
      .expect(400);
    expect(invalidExistingDate.body).toMatchObject({
      code: 'INVALID_NEXT_DUE_DATE',
    });
  });

  it('hides inaccessible pets and records belonging to another pet', async () => {
    const recordId = await createRecord();
    const otherRecordId = randomUUID();
    await database.connection.insert(healthVaccinationRecords).values({
      id: otherRecordId,
      petId: otherPetId,
      vaccineName: 'Other',
      appliedDate: '2024-01-01',
      nextDueDate: null,
      recordedByAccountId: owner.id,
    });
    for (const method of ['patch', 'delete'] as const) {
      const unauthorized = await request(application.getHttpServer())
        [method](path(recordId))
        .set('Authorization', `Bearer ${outsider.token}`)
        .send(method === 'patch' ? { vaccineName: 'Changed' } : undefined)
        .expect(404);
      expect(unauthorized.body).toMatchObject({ code: 'PET_NOT_FOUND' });
      const wrongPet = await request(application.getHttpServer())
        [method](path(otherRecordId))
        .set('Authorization', `Bearer ${owner.token}`)
        .send(method === 'patch' ? { vaccineName: 'Changed' } : undefined)
        .expect(404);
      expect(wrongPet.body).toMatchObject({
        code: 'VACCINATION_RECORD_NOT_FOUND',
        message: 'Vaccination record was not found',
      });
      const missing = await request(application.getHttpServer())
        [method](path(randomUUID()))
        .set('Authorization', `Bearer ${owner.token}`)
        .send(method === 'patch' ? { vaccineName: 'Changed' } : undefined)
        .expect(404);
      expect(missing.body).toMatchObject({
        code: 'VACCINATION_RECORD_NOT_FOUND',
      });
    }
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, collaboratorMembershipId));
    for (const method of ['patch', 'delete'] as const) {
      const response = await request(application.getHttpServer())
        [method](path(recordId))
        .set('Authorization', `Bearer ${collaborator.token}`)
        .send(method === 'patch' ? { vaccineName: 'Changed' } : undefined)
        .expect(404);
      expect(response.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    }
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, petId));
    for (const method of ['patch', 'delete'] as const) {
      const response = await request(application.getHttpServer())
        [method](path(recordId))
        .set('Authorization', `Bearer ${owner.token}`)
        .send(method === 'patch' ? { vaccineName: 'Changed' } : undefined)
        .expect(404);
      expect(response.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    }
    const history = await request(application.getHttpServer())
      .get(`/pets/${petId}/health/vaccination-records`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(history.body).toMatchObject({ items: [{ id: recordId }] });
  });

  it('hard deletes with 204, updates history, and returns 404 on repeat', async () => {
    const recordId = await createRecord();
    const first = await request(application.getHttpServer())
      .delete(path(recordId))
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(204);
    expect(first.text).toBe('');
    const history = await request(application.getHttpServer())
      .get(`/pets/${petId}/health/vaccination-records`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(history.body).toMatchObject({ items: [] });
    const second = await request(application.getHttpServer())
      .delete(path(recordId))
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);
    expect(second.body).toMatchObject({ code: 'VACCINATION_RECORD_NOT_FOUND' });
    const collaboratorRecordId = await createRecord(petId, collaborator);
    await request(application.getHttpServer())
      .delete(path(collaboratorRecordId))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(204);
  });

  it('validates DELETE body, UUIDs and Bearer JWT', async () => {
    const recordId = await createRecord();
    const extra = await request(application.getHttpServer())
      .delete(path(recordId))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ extra: true })
      .expect(400);
    expect(extra.body).toMatchObject({ code: 'INVALID_REQUEST' });
    for (const method of ['patch', 'delete'] as const) {
      for (const url of [path('bad'), path(recordId, 'bad')]) {
        const response = await request(application.getHttpServer())
          [method](url)
          .set('Authorization', `Bearer ${owner.token}`)
          .send(method === 'patch' ? { vaccineName: 'Changed' } : undefined)
          .expect(400);
        expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
      }
      await request(application.getHttpServer())
        [method](path(recordId))
        .send(method === 'patch' ? { vaccineName: 'Changed' } : undefined)
        .expect(401);
    }
  });
});
