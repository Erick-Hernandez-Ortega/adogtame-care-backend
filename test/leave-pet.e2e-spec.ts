import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
  petInvitations,
  petMemberships,
  pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface AccountFixture {
  id: string;
  token: string;
}

describe('POST /pets/:petId/leave (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let owner: AccountFixture;
  let collaborator: AccountFixture;
  let outsider: AccountFixture;
  let petId: string;
  let membershipId: string;

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
    owner = await account('leave-owner');
    collaborator = await account('leave-collaborator');
    outsider = await account('leave-outsider');
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
    membershipId = randomUUID();
  });

  afterEach(async () => {
    await database.connection
      .delete(petInvitations)
      .where(eq(petInvitations.petId, petId));
    await database.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, petId));
    await database.connection.delete(pets).where(eq(pets.id, petId));
  });

  async function addCollaborator(
    status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  ): Promise<void> {
    await database.connection.insert(petMemberships).values({
      id: membershipId,
      petId,
      accountId: collaborator.id,
      role: 'COLLABORATOR',
      status,
    });
  }

  it('leaves, retries with the same membership, and loses GET access', async () => {
    await addCollaborator();
    const path = `/pets/${petId}/leave`;
    const beforeList = await request(application.getHttpServer())
      .get('/pets')
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(200);
    expect(beforeList.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: petId })]),
    );
    const first = await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(204);
    expect(first.text).toBe('');
    const retry = await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${collaborator.token}`)
      .send({})
      .expect(204);
    expect(retry.text).toBe('');
    const membershipRows = await database.connection
      .select()
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, petId),
          eq(petMemberships.accountId, collaborator.id),
        ),
      );
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0]).toMatchObject({
      id: membershipId,
      accountId: collaborator.id,
      role: 'COLLABORATOR',
      status: 'INACTIVE',
    });
    const afterList = await request(application.getHttpServer())
      .get('/pets')
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(200);
    expect(afterList.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: petId })]),
    );
    const detail = await request(application.getHttpServer())
      .get(`/pets/${petId}`)
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(404);
    expect(detail.body).toMatchObject({ code: 'PET_NOT_FOUND' });
  });

  it('allows leave and retry on an archived pet', async () => {
    await addCollaborator();
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, petId));
    const path = `/pets/${petId}/leave`;
    await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(204);
    await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(204);
  });

  it('returns the same 404 for a missing pet and a missing membership', async () => {
    for (const id of [petId, randomUUID()]) {
      const response = await request(application.getHttpServer())
        .post(`/pets/${id}/leave`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
      expect(response.body).toMatchObject({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });
    }
  });

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'rejects the last owner of an %s pet without an UPDATE',
    async (status) => {
      if (status === 'ARCHIVED')
        await database.connection
          .update(pets)
          .set({ status })
          .where(eq(pets.id, petId));
      const before = await database.connection
        .select()
        .from(petMemberships)
        .where(eq(petMemberships.petId, petId));
      const response = await request(application.getHttpServer())
        .post(`/pets/${petId}/leave`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'LAST_OWNER_CANNOT_LEAVE',
        message: 'Last owner cannot leave a pet',
      });
      expect(
        await database.connection
          .select()
          .from(petMemberships)
          .where(eq(petMemberships.petId, petId)),
      ).toEqual(before);
    },
  );

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'allows owner leave and retry on an %s pet and removes access',
    async (status) => {
      await addCollaborator();
      await request(application.getHttpServer())
        .post(`/pets/${petId}/members/${membershipId}/promote`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);
      if (status === 'ARCHIVED')
        await database.connection
          .update(pets)
          .set({ status })
          .where(eq(pets.id, petId));
      const path: string = `/pets/${petId}/leave`;
      const response = await request(application.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${collaborator.token}`)
        .expect(204);
      expect(response.text).toBe('');
      const beforeRetry = await database.connection
        .select()
        .from(petMemberships)
        .where(eq(petMemberships.id, membershipId));
      await request(application.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${collaborator.token}`)
        .send({})
        .expect(204);
      expect(
        await database.connection
          .select()
          .from(petMemberships)
          .where(eq(petMemberships.id, membershipId)),
      ).toEqual(beforeRetry);
      const members = await request(application.getHttpServer())
        .get(`/pets/${petId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(
        (members.body as { members: { membershipId: string }[] }).members.map(
          (member) => member.membershipId,
        ),
      ).not.toContain(membershipId);
      const inaccessible = await request(application.getHttpServer())
        .get(`/pets/${petId}/members`)
        .set('Authorization', `Bearer ${collaborator.token}`)
        .expect(404);
      expect(inaccessible.body).toMatchObject({ code: 'PET_NOT_FOUND' });
      expect(beforeRetry[0]).toMatchObject({
        role: 'OWNER',
        status: 'INACTIVE',
      });
    },
  );

  it('requires authentication, a UUID, and an empty body', async () => {
    await addCollaborator();
    const path = `/pets/${petId}/leave`;
    const unauthenticated = await request(application.getHttpServer())
      .post(path)
      .expect(401);
    expect(unauthenticated.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    const invalidId = await request(application.getHttpServer())
      .post('/pets/invalid/leave')
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(400);
    expect(invalidId.body).toMatchObject({ code: 'INVALID_REQUEST' });
    for (const body of [
      { accountId: outsider.id },
      { membershipId },
      { role: 'OWNER' },
      { status: 'INACTIVE' },
    ]) {
      const invalidBody = await request(application.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${collaborator.token}`)
        .send(body)
        .expect(400);
      expect(invalidBody.body).toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
  it('rejects nil UUIDs and unexpected query parameters', async () => {
    for (const path of [
      '/pets/00000000-0000-0000-0000-000000000000/leave',
      `/pets/${petId}/leave?unexpected=true`,
    ]) {
      const response = await request(application.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
});
