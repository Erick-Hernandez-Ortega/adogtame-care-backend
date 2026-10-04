import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { PetAllergyListItem } from '../src/health/application/persistence/pet-allergy.reader';
import { healthPetAllergies } from '../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface AccountFixture {
  readonly id: string;
  readonly token: string;
}

describe('GET /pets/:petId/health/allergies (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let owner: AccountFixture;
  let collaborator: AccountFixture;
  let outsider: AccountFixture;
  let petId: string;
  let otherPetId: string;

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

  async function createPet(): Promise<string> {
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
    return (response.body as { id: string }).id;
  }

  beforeAll(async (): Promise<void> => {
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

  afterAll(async (): Promise<void> => {
    await database.connection
      .delete(accounts)
      .where(inArray(accounts.id, [owner.id, collaborator.id, outsider.id]));
    await application.close();
  });

  beforeEach(async (): Promise<void> => {
    petId = await createPet();
    otherPetId = await createPet();
    await database.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId,
      accountId: collaborator.id,
      role: 'COLLABORATOR',
      status: 'ACTIVE',
    });
  });

  afterEach(async (): Promise<void> => {
    await database.connection
      .delete(healthPetAllergies)
      .where(inArray(healthPetAllergies.petId, [petId, otherPetId]));
    await database.connection
      .delete(petMemberships)
      .where(inArray(petMemberships.petId, [petId, otherPetId]));
    await database.connection
      .delete(pets)
      .where(inArray(pets.id, [petId, otherPetId]));
  });

  function path(requestedPetId: string = petId): string {
    return `/pets/${requestedPetId}/health/allergies`;
  }

  async function record(
    author: AccountFixture = owner,
    requestedPetId: string = petId,
  ): Promise<PetAllergyListItem> {
    const response = await request(application.getHttpServer())
      .post(path(requestedPetId))
      .set('Authorization', `Bearer ${author.token}`)
      .send({
        allergen: '  Penicillin  ',
        category: 'MEDICATION',
        severity: 'SEVERE',
        notes: '  Reported reaction.  ',
      })
      .expect(201);
    const recorded: PetAllergyListItem = response.body as PetAllergyListItem;
    return {
      id: recorded.id,
      allergen: 'Penicillin',
      category: 'MEDICATION',
      severity: 'SEVERE',
      notes: 'Reported reaction.',
      recordedByAccountId: author.id,
    };
  }

  it.each([
    { status: 'ACTIVE', role: 'OWNER' },
    { status: 'ACTIVE', role: 'COLLABORATOR' },
    { status: 'ARCHIVED', role: 'OWNER' },
    { status: 'ARCHIVED', role: 'COLLABORATOR' },
  ] as const)(
    'returns the exact list contract for an $status pet and active $role',
    async ({ status, role }): Promise<void> => {
      const item: PetAllergyListItem = await record(collaborator);
      await record(owner, otherPetId);
      if (status === 'ARCHIVED') {
        await request(application.getHttpServer())
          .post(`/pets/${petId}/archive`)
          .set('Authorization', `Bearer ${owner.token}`)
          .expect(204);
      }
      const requester: AccountFixture = role === 'OWNER' ? owner : collaborator;
      const response = await request(application.getHttpServer())
        .get(path())
        .set('Authorization', `Bearer ${requester.token}`)
        .expect(200);
      expect(response.body).toEqual({ items: [item] });
    },
  );

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'returns empty items for an accessible %s pet',
    async (status): Promise<void> => {
      if (status === 'ARCHIVED') {
        await request(application.getHttpServer())
          .post(`/pets/${petId}/archive`)
          .set('Authorization', `Bearer ${owner.token}`)
          .expect(204);
      }
      for (const requester of [owner, collaborator]) {
        const response = await request(application.getHttpServer())
          .get(path())
          .set('Authorization', `Bearer ${requester.token}`)
          .expect(200);
        expect(response.body).toEqual({ items: [] });
      }
    },
  );

  it('orders controlled timestamps and UUID ties while preserving duplicates and nullable notes', async (): Promise<void> => {
    const older: PetAllergyListItem = {
      id: '20000000-0000-4000-8000-000000000004',
      allergen: 'Chicken',
      category: 'FOOD',
      severity: 'MILD',
      notes: null,
      recordedByAccountId: owner.id,
    };
    const tiedLow: PetAllergyListItem = {
      ...older,
      id: '20000000-0000-4000-8000-000000000002',
    };
    const tiedHigh: PetAllergyListItem = {
      ...older,
      id: '20000000-0000-4000-8000-000000000003',
    };
    const newer: PetAllergyListItem = {
      id: '20000000-0000-4000-8000-000000000001',
      allergen: 'Pollen',
      category: 'ENVIRONMENTAL',
      severity: 'UNKNOWN',
      notes: 'Seasonal reaction.',
      recordedByAccountId: collaborator.id,
    };
    await database.connection.insert(healthPetAllergies).values([
      {
        ...older,
        petId,
        createdAt: sql`'2026-09-30T12:00:00.123456Z'::timestamptz`,
      },
      {
        ...tiedLow,
        petId,
        createdAt: sql`'2026-10-01T12:00:00.123456Z'::timestamptz`,
      },
      {
        ...newer,
        petId,
        createdAt: sql`'2026-10-01T12:00:00.123457Z'::timestamptz`,
      },
      {
        ...tiedHigh,
        petId,
        createdAt: sql`'2026-10-01T12:00:00.123456Z'::timestamptz`,
      },
    ]);
    await record(owner, otherPetId);
    const response = await request(application.getHttpServer())
      .get(path())
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(response.body).toEqual({ items: [newer, tiedHigh, tiedLow, older] });
  });

  it('returns all entries beyond the history default page size', async (): Promise<void> => {
    const items: PetAllergyListItem[] = Array.from(
      { length: 25 },
      (): PetAllergyListItem => ({
        id: randomUUID(),
        allergen: 'Chicken',
        category: 'FOOD',
        severity: 'UNKNOWN',
        notes: null,
        recordedByAccountId: owner.id,
      }),
    );
    await database.connection.insert(healthPetAllergies).values(
      items.map((item: PetAllergyListItem) => ({
        ...item,
        petId,
        createdAt: sql`'2026-10-01T12:00:00Z'::timestamptz`,
      })),
    );
    items.sort(
      (firstItem: PetAllergyListItem, secondItem: PetAllergyListItem): number =>
        secondItem.id.localeCompare(firstItem.id),
    );
    const response = await request(application.getHttpServer())
      .get(path())
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(response.body).toEqual({ items });
  });

  it('hides missing pets, inactive authors of both roles and accounts without membership', async (): Promise<void> => {
    await record(owner);
    await record(collaborator);
    for (const requester of [owner, collaborator]) {
      await database.connection
        .update(petMemberships)
        .set({ status: 'INACTIVE' })
        .where(
          and(
            eq(petMemberships.petId, petId),
            eq(petMemberships.accountId, requester.id),
          ),
        );
      const response = await request(application.getHttpServer())
        .get(path())
        .set('Authorization', `Bearer ${requester.token}`)
        .expect(404);
      expect(response.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });
    }
    for (const requestedPetId of [petId, randomUUID()]) {
      const response = await request(application.getHttpServer())
        .get(path(requestedPetId))
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
      expect(response.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });
    }
  });

  it('requires a valid Bearer JWT', async (): Promise<void> => {
    for (const token of [null, 'invalid-token']) {
      const pendingRequest = request(application.getHttpServer()).get(path());
      if (token !== null)
        pendingRequest.set('Authorization', `Bearer ${token}`);
      const response = await pendingRequest.expect(401);
      expect(response.body).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required',
      });
    }
  });

  it.each(['invalid-id', '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid pet ID %s',
    async (requestedPetId: string): Promise<void> => {
      const response = await request(application.getHttpServer())
        .get(path(requestedPetId))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(response.body).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    },
  );

  it.each([
    'limit',
    'cursor',
    'category',
    'severity',
    'q',
    'sort',
    'order',
    'unexpected',
  ])(
    'rejects unsupported query parameter %s',
    async (parameter: string): Promise<void> => {
      const response = await request(application.getHttpServer())
        .get(path())
        .query({ [parameter]: '1' })
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(response.body).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    },
  );
});
