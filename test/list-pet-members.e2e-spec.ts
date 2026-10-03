import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import type { PetMember } from '../src/pet-management/application/list-pet-members/list-pet-members';
import {
  petInvitations,
  petMemberships,
  pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface AccountFixture {
  readonly accountId: string;
  readonly email: string;
  readonly accessToken: string;
}

describe('GET /pets/:petId/members (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let accountFixtures: AccountFixture[];
  let petId: string;
  let expectedMembers: PetMember[];

  async function registerAndAuthenticate(
    label: string,
  ): Promise<AccountFixture> {
    const email: string = `${label}-${randomUUID()}@example.com`;
    const password: string = 'a secure password';
    const registration = await request(application.getHttpServer())
      .post('/accounts')
      .send({ email, password })
      .expect(201);
    const authentication = await request(application.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return {
      accountId: (registration.body as { id: string }).id,
      email,
      accessToken: (authentication.body as { accessToken: string }).accessToken,
    };
  }

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = fixture.createNestApplication();
    await application.init();
    database = application.get(DatabaseService);
    accountFixtures = [];
    for (const label of [
      'z-owner',
      'a-owner',
      'z-collaborator',
      'a-collaborator',
      'inactive-owner',
      'inactive-collaborator',
      'invitee',
    ]) {
      accountFixtures.push(
        await registerAndAuthenticate(`pet-members-${label}`),
      );
    }
  });

  afterAll(async () => {
    await database.connection.delete(accounts).where(
      inArray(
        accounts.id,
        accountFixtures.map((account): string => account.accountId),
      ),
    );
    await application.close();
  });

  beforeEach(async () => {
    const creator: AccountFixture = accountFixtures[0];
    const registration = await request(application.getHttpServer())
      .post('/pets')
      .set('Authorization', `Bearer ${creator.accessToken}`)
      .send({
        name: 'Luna',
        species: 'DOG',
        breed: { name: 'Mixed', kind: 'CUSTOM' },
        sex: 'FEMALE',
        birthInformation: { date: '2020-01-01', accuracy: 'EXACT' },
      })
      .expect(201);
    petId = (registration.body as { id: string }).id;
    const creatorMemberships = await database.connection
      .select({ id: petMemberships.id })
      .from(petMemberships)
      .where(eq(petMemberships.petId, petId));
    const collaboratorMembershipIds: string[] = [
      randomUUID(),
      randomUUID(),
    ].sort();
    expectedMembers = [
      {
        membershipId: randomUUID(),
        accountId: accountFixtures[1].accountId,
        email: accountFixtures[1].email,
        role: 'OWNER',
      },
      {
        membershipId: creatorMemberships[0].id,
        accountId: creator.accountId,
        email: creator.email,
        role: 'OWNER',
      },
      {
        membershipId: collaboratorMembershipIds[0],
        accountId: accountFixtures[2].accountId,
        email: accountFixtures[2].email,
        role: 'COLLABORATOR',
      },
      {
        membershipId: collaboratorMembershipIds[1],
        accountId: accountFixtures[3].accountId,
        email: accountFixtures[3].email,
        role: 'COLLABORATOR',
      },
    ];
    await database.connection
      .update(petMemberships)
      .set({ createdAt: new Date('2026-09-26T12:00:02Z') })
      .where(eq(petMemberships.id, expectedMembers[1].membershipId));
    await database.connection.insert(petMemberships).values([
      {
        id: expectedMembers[0].membershipId,
        petId,
        accountId: expectedMembers[0].accountId,
        role: 'OWNER',
        status: 'ACTIVE',
        createdAt: new Date('2026-09-26T12:00:01Z'),
      },
      ...expectedMembers
        .slice(2)
        .reverse()
        .map((member: PetMember) => ({
          id: member.membershipId,
          petId,
          accountId: member.accountId,
          role: member.role,
          status: 'ACTIVE',
          createdAt: new Date('2026-09-25T12:00:00Z'),
        })),
      {
        id: randomUUID(),
        petId,
        accountId: accountFixtures[4].accountId,
        role: 'OWNER',
        status: 'INACTIVE',
      },
      {
        id: randomUUID(),
        petId,
        accountId: accountFixtures[5].accountId,
        role: 'COLLABORATOR',
        status: 'INACTIVE',
      },
    ]);
    await database.connection.insert(petInvitations).values({
      id: randomUUID(),
      petId,
      invitedEmail: accountFixtures[6].email,
      invitedByAccountId: accountFixtures[4].accountId,
      status: 'PENDING',
      createdAt: new Date('2026-10-01T12:00:00Z'),
      expiresAt: new Date('2026-10-08T12:00:00Z'),
    });
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

  function path(requestedPetId: string = petId): string {
    return `/pets/${requestedPetId}/members`;
  }

  it.each([
    { status: 'ACTIVE', requesterIndex: 0, role: 'OWNER' },
    { status: 'ACTIVE', requesterIndex: 2, role: 'COLLABORATOR' },
    { status: 'ARCHIVED', requesterIndex: 0, role: 'OWNER' },
    { status: 'ARCHIVED', requesterIndex: 2, role: 'COLLABORATOR' },
  ] as const)(
    'returns the exact current member contract for an $status pet and active $role',
    async ({ status, requesterIndex }): Promise<void> => {
      await database.connection
        .update(pets)
        .set({ status })
        .where(eq(pets.id, petId));
      const response = await request(application.getHttpServer())
        .get(path())
        .set(
          'Authorization',
          `Bearer ${accountFixtures[requesterIndex].accessToken}`,
        )
        .expect(200);
      expect(response.body).toEqual({ members: expectedMembers });
    },
  );

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'returns PET_NOT_FOUND for an %s pet to inactive members and a pending invitee',
    async (status) => {
      await database.connection
        .update(pets)
        .set({ status })
        .where(eq(pets.id, petId));
      for (const account of accountFixtures.slice(4)) {
        const response = await request(application.getHttpServer())
          .get(path())
          .set('Authorization', `Bearer ${account.accessToken}`)
          .expect(404);
        expect(response.body).toEqual({
          code: 'PET_NOT_FOUND',
          message: 'Pet was not found',
        });
      }
      const missingPetResponse = await request(application.getHttpServer())
        .get(path(randomUUID()))
        .set('Authorization', `Bearer ${accountFixtures[0].accessToken}`)
        .expect(404);
      expect(missingPetResponse.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });
    },
  );

  it('loses access immediately on the next request after its membership becomes inactive', async () => {
    const requester: AccountFixture = accountFixtures[2];
    await request(application.getHttpServer())
      .get(path())
      .set('Authorization', `Bearer ${requester.accessToken}`)
      .expect(200);
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, expectedMembers[2].membershipId));
    const response = await request(application.getHttpServer())
      .get(path())
      .set('Authorization', `Bearer ${requester.accessToken}`)
      .expect(404);
    expect(response.body).toEqual({
      code: 'PET_NOT_FOUND',
      message: 'Pet was not found',
    });
  });

  it('requires a valid Bearer JWT', async () => {
    for (const token of [null, 'invalid-token']) {
      const pendingRequest = request(application.getHttpServer()).get(path());
      if (token !== null) {
        pendingRequest.set('Authorization', `Bearer ${token}`);
      }
      const response = await pendingRequest.expect(401);
      expect(response.body).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required',
      });
    }
  });

  it.each(['invalid-id', '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid pet ID %s',
    async (requestedPetId: string) => {
      const response = await request(application.getHttpServer())
        .get(path(requestedPetId))
        .set('Authorization', `Bearer ${accountFixtures[0].accessToken}`)
        .expect(400);
      expect(response.body).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    },
  );

  it.each(['limit', 'cursor', 'offset', 'page', 'unexpected'])(
    'rejects unsupported query parameter %s',
    async (parameter: string) => {
      const response = await request(application.getHttpServer())
        .get(path())
        .query({ [parameter]: '1' })
        .set('Authorization', `Bearer ${accountFixtures[0].accessToken}`)
        .expect(400);
      expect(response.body).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    },
  );
});
