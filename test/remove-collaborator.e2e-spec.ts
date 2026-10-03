import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
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

describe('DELETE /pets/:petId/members/:membershipId (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let owner: AccountFixture;
  let collaborator: AccountFixture;
  let outsider: AccountFixture;
  let petIds: string[];
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
    petIds = [];
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
    petIds.push(petId);
    membershipId = randomUUID();
  });

  afterEach(async () => {
    await database.connection
      .delete(petInvitations)
      .where(inArray(petInvitations.petId, petIds));
    await database.connection
      .delete(petMemberships)
      .where(inArray(petMemberships.petId, petIds));
    await database.connection.delete(pets).where(inArray(pets.id, petIds));
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

  function removeMember(
    token: string = owner.token,
    target: string = membershipId,
    requestedPetId: string = petId,
  ) {
    return request(application.getHttpServer())
      .delete(`/pets/${requestedPetId}/members/${target}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function ownerMembershipId(): Promise<string> {
    const memberships = await database.connection
      .select({ id: petMemberships.id })
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, petId),
          eq(petMemberships.accountId, owner.id),
        ),
      );
    return memberships[0].id;
  }

  it('removes access, retries with an empty body, and disappears from the public member list', async () => {
    await addCollaborator();
    const before = await request(application.getHttpServer())
      .get(`/pets/${petId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(
      (before.body as { members: { membershipId: string }[] }).members.map(
        (member): string => member.membershipId,
      ),
    ).toContain(membershipId);
    const removed = await removeMember().expect(204);
    expect(removed.text).toBe('');
    const retry = await removeMember().send({}).expect(204);
    expect(retry.text).toBe('');
    const after = await request(application.getHttpServer())
      .get(`/pets/${petId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(
      (after.body as { members: { membershipId: string }[] }).members.map(
        (member): string => member.membershipId,
      ),
    ).not.toContain(membershipId);
    const inaccessible = await request(application.getHttpServer())
      .get(`/pets/${petId}/members`)
      .set('Authorization', `Bearer ${collaborator.token}`)
      .expect(404);
    expect(inaccessible.body).toMatchObject({ code: 'PET_NOT_FOUND' });
  });

  it.each([
    'collaborator',
    'inactive owner',
    'outsider',
    'archived',
    'missing pet',
  ] as const)('hides %s access before target errors', async (scenario) => {
    await addCollaborator();
    let token: string = owner.token;
    let requestedPetId: string = petId;
    if (scenario === 'collaborator') token = collaborator.token;
    if (scenario === 'outsider') token = outsider.token;
    if (scenario === 'inactive owner')
      await database.connection
        .update(petMemberships)
        .set({ status: 'INACTIVE' })
        .where(eq(petMemberships.id, await ownerMembershipId()));
    if (scenario === 'archived')
      await database.connection
        .update(pets)
        .set({ status: 'ARCHIVED' })
        .where(eq(pets.id, petId));
    if (scenario === 'missing pet') requestedPetId = randomUUID();
    for (const target of [
      membershipId,
      randomUUID(),
      await ownerMembershipId(),
    ]) {
      const response = await removeMember(token, target, requestedPetId).expect(
        404,
      );
      expect(response.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    }
  });

  it('returns PET_MEMBER_NOT_FOUND for missing targets and targets from another pet', async () => {
    const other = await request(application.getHttpServer())
      .post('/pets')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        name: 'Other',
        species: 'CAT',
        breed: { name: 'Mixed', kind: 'CUSTOM' },
        sex: 'UNKNOWN',
        birthInformation: { date: '2020-01-01', accuracy: 'EXACT' },
      })
      .expect(201);
    const otherPetId: string = (other.body as { id: string }).id;
    petIds.push(otherPetId);
    const otherMemberships = await database.connection
      .select({ id: petMemberships.id })
      .from(petMemberships)
      .where(eq(petMemberships.petId, otherPetId));
    for (const target of [randomUUID(), otherMemberships[0].id]) {
      const response = await removeMember(owner.token, target).expect(404);
      expect(response.body).toMatchObject({
        code: 'PET_MEMBER_NOT_FOUND',
        message: 'Pet member was not found',
      });
    }
  });

  it.each(['ACTIVE', 'INACTIVE'] as const)(
    'rejects a second %s owner and self-removal',
    async (status) => {
      await addCollaborator(status);
      await database.connection
        .update(petMemberships)
        .set({ role: 'OWNER' })
        .where(eq(petMemberships.id, membershipId));
      for (const target of [membershipId, await ownerMembershipId()]) {
        const response = await removeMember(owner.token, target).expect(409);
        expect(response.body).toMatchObject({
          code: 'OWNER_REMOVAL_NOT_SUPPORTED',
        });
      }
    },
  );

  it('requires authentication before structural validation', async () => {
    for (const path of [
      `/pets/${petId}/members/${membershipId}`,
      '/pets/invalid/members/invalid',
    ]) {
      const response = await request(application.getHttpServer())
        .delete(path)
        .expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    const invalidToken = await removeMember('invalid-token').expect(401);
    expect(invalidToken.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it.each(['invalid', '00000000-0000-0000-0000-000000000000'])(
    'rejects %s UUIDs in both path positions',
    async (invalidId) => {
      for (const [requestedPetId, target] of [
        [invalidId, membershipId],
        [petId, invalidId],
      ]) {
        const response = await removeMember(
          owner.token,
          target,
          requestedPetId,
        ).expect(400);
        expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
      }
    },
  );

  it('rejects unexpected query parameters and nonempty or non-object bodies', async () => {
    await addCollaborator();
    const invalidQuery = await removeMember()
      .query({ status: 'INACTIVE' })
      .expect(400);
    expect(invalidQuery.body).toMatchObject({ code: 'INVALID_REQUEST' });
    for (const body of [
      { accountId: outsider.id },
      { status: 'INACTIVE' },
      { role: 'OWNER' },
      [],
    ]) {
      const invalidBody = await removeMember().send(body).expect(400);
      expect(invalidBody.body).toMatchObject({ code: 'INVALID_REQUEST' });
    }
    const memberships = await database.connection
      .select()
      .from(petMemberships)
      .where(eq(petMemberships.id, membershipId));
    expect(memberships[0].status).toBe('ACTIVE');
  });
});
