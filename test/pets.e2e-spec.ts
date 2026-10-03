import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import type {
  AccessiblePetSummary,
  PetDetail,
} from '../src/pet-management/application/persistence/pet-query.repository';
import type { RegisteredPet } from '../src/pet-management/application/register-pet/register-pet.types';
import type { CreatedPetInvitation } from '../src/pet-management/application/invite-collaborator/invite-collaborator.types';
import {
  petInvitations,
  petMemberships,
  pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface RegisteredAccountResponse {
  id: string;
}

interface AuthenticationResponse {
  accessToken: string;
}

interface AuthenticatedAccountFixture {
  accountId: string;
  accessToken: string;
  email: string;
}

function validPetRequest(): Record<string, unknown> {
  return {
    name: 'Luna',
    species: 'DOG',
    breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
    sex: 'FEMALE',
    birthInformation: { date: '2021-06-14', accuracy: 'EXACT' },
  };
}

async function registerAndAuthenticate(
  application: INestApplication<App>,
  label: string,
): Promise<AuthenticatedAccountFixture> {
  const email: string = `${label}-${randomUUID()}@example.com`;
  const password: string = 'a secure password';
  const registrationResponse = await request(application.getHttpServer())
    .post('/accounts')
    .send({ email, password })
    .expect(201);
  const account: RegisteredAccountResponse =
    registrationResponse.body as RegisteredAccountResponse;
  const authenticationResponse = await request(application.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  const authentication: AuthenticationResponse =
    authenticationResponse.body as AuthenticationResponse;

  return {
    accountId: account.id,
    accessToken: authentication.accessToken,
    email,
  };
}

describe('POST /pets (e2e)', () => {
  let application: INestApplication<App>;
  let databaseService: DatabaseService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture.createNestApplication();
    await application.init();
    databaseService = application.get(DatabaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  it('registers a pet owned by the authenticated account', async () => {
    const fixture: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'pet-owner',
    );
    let petId: string | undefined;

    try {
      const response = await request(application.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .send(validPetRequest())
        .expect(201);
      const body: RegisteredPet = response.body as RegisteredPet;
      petId = body.id;

      expect(body).toMatchObject({
        name: 'Luna',
        species: 'DOG',
        color: null,
        distinctiveMarks: null,
        microchip: null,
        status: 'ACTIVE',
        memberships: [{ accountId: fixture.accountId, role: 'OWNER' }],
      });

      const savedMemberships = await databaseService.connection
        .select({
          accountId: petMemberships.accountId,
          role: petMemberships.role,
          status: petMemberships.status,
        })
        .from(petMemberships)
        .where(eq(petMemberships.petId, body.id));

      expect(savedMemberships).toEqual([
        { accountId: fixture.accountId, role: 'OWNER', status: 'ACTIVE' },
      ]);
    } finally {
      if (petId !== undefined) {
        await databaseService.connection
          .delete(petMemberships)
          .where(eq(petMemberships.petId, petId));
        await databaseService.connection.delete(pets).where(eq(pets.id, petId));
      }

      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, fixture.email));
    }
  });

  it('returns unauthenticated without Authorization', async () => {
    const response = await request(application.getHttpServer())
      .post('/pets')
      .send(validPetRequest())
      .expect(401);

    expect(response.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
  });

  it('returns unauthenticated for an invalid JWT', async () => {
    const response = await request(application.getHttpServer())
      .post('/pets')
      .set('Authorization', 'Bearer invalid-token')
      .send(validPetRequest())
      .expect(401);

    expect(response.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
  });

  it('returns unauthenticated when the token account no longer exists', async () => {
    const fixture: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'deleted-account',
    );

    await databaseService.connection
      .delete(accounts)
      .where(eq(accounts.id, fixture.accountId));

    const response = await request(application.getHttpServer())
      .post('/pets')
      .set('Authorization', `Bearer ${fixture.accessToken}`)
      .send(validPetRequest())
      .expect(401);

    expect(response.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
  });

  it('rejects ownerAccountId in the body instead of allowing impersonation', async () => {
    const fixture: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'impersonation',
    );

    try {
      const response = await request(application.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .send({
          ...validPetRequest(),
          ownerAccountId: randomUUID(),
        })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, fixture.email));
    }
  });

  it('returns 422 when the domain rejects an authenticated pet registration', async () => {
    const fixture: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'invalid-pet',
    );

    try {
      const response = await request(application.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .send({
          ...validPetRequest(),
          name: '   ',
        })
        .expect(422);

      expect(response.body).toMatchObject({ code: 'INVALID_PET' });
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, fixture.email));
    }
  });
});

describe('PATCH /pets/:petId (e2e)', () => {
  let application: INestApplication<App>;
  let databaseService: DatabaseService;
  let owner: AuthenticatedAccountFixture;
  let collaborator: AuthenticatedAccountFixture;
  let outsider: AuthenticatedAccountFixture;
  let petId: string;
  let ownerMembershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = moduleFixture.createNestApplication();
    await application.init();
    databaseService = application.get(DatabaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    owner = await registerAndAuthenticate(application, 'update-owner');
    collaborator = await registerAndAuthenticate(
      application,
      'update-collaborator',
    );
    outsider = await registerAndAuthenticate(application, 'update-outsider');
    const response = await request(application.getHttpServer())
      .post('/pets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        ...validPetRequest(),
        color: 'Golden',
        distinctiveMarks: 'White spot',
        microchip: '12345',
      })
      .expect(201);
    petId = (response.body as RegisteredPet).id;
    const ownerRows = await databaseService.connection
      .select({ id: petMemberships.id })
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, petId),
          eq(petMemberships.accountId, owner.accountId),
        ),
      );
    ownerMembershipId = ownerRows[0].id;
    await databaseService.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId,
      accountId: collaborator.accountId,
      role: 'COLLABORATOR',
      status: 'ACTIVE',
    });
  });

  afterEach(async () => {
    await databaseService.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, petId));
    await databaseService.connection.delete(pets).where(eq(pets.id, petId));
    for (const account of [owner, collaborator, outsider]) {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, account.accountId));
    }
  });

  function patch(
    body: Record<string, unknown>,
    accessToken: string = owner.accessToken,
    targetPetId: string = petId,
  ) {
    return request(application.getHttpServer())
      .patch(`/pets/${targetPetId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }

  it('updates a simple field and GET Pet Detail reflects it', async () => {
    const response = await patch({ name: ' Nala ' }).expect(200);
    expect(response.body).toMatchObject({
      id: petId,
      name: 'Nala',
      color: 'Golden',
      status: 'ACTIVE',
      role: 'OWNER',
    });
    expect(response.body).not.toHaveProperty('memberships');
    expect(response.body).not.toHaveProperty('updatedAt');
    const detail = await request(application.getHttpServer())
      .get(`/pets/${petId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(detail.body).toEqual(response.body);
  });

  it('updates combined fields and clears nullable fields', async () => {
    const response = await patch({
      species: 'CAT',
      breed: { name: ' Domestic shorthair ', kind: 'CUSTOM' },
      sex: 'UNKNOWN',
      birthInformation: { date: '2020-01-02', accuracy: 'APPROXIMATE' },
      color: null,
      distinctiveMarks: null,
      microchip: null,
    }).expect(200);
    expect(response.body).toMatchObject({
      species: 'CAT',
      breed: { name: 'Domestic shorthair', kind: 'CUSTOM' },
      sex: 'UNKNOWN',
      birthInformation: { date: '2020-01-02', accuracy: 'APPROXIMATE' },
      color: null,
      distinctiveMarks: null,
      microchip: null,
    });
    const detail = await request(application.getHttpServer())
      .get(`/pets/${petId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(detail.body).toEqual(response.body);
  });

  it.each([
    [{}, 'INVALID_REQUEST'],
    [{ status: 'ARCHIVED' }, 'INVALID_REQUEST'],
    [{ ownerAccountId: randomUUID() }, 'INVALID_REQUEST'],
    [{ name: null }, 'INVALID_REQUEST'],
    [{ species: 'BIRD' }, 'INVALID_REQUEST'],
    [{ breed: { name: 'Mixed' } }, 'INVALID_REQUEST'],
    [{ birthInformation: { date: '2020-01-01' } }, 'INVALID_REQUEST'],
    [{ color: 42 }, 'INVALID_REQUEST'],
  ])('rejects structurally invalid body %#', async (body, code) => {
    const response = await patch(body).expect(400);
    expect(response.body).toMatchObject({ code });
  });

  it.each([
    { name: '   ' },
    { breed: { name: ' ', kind: 'KNOWN' } },
    { birthInformation: { date: '2020-02-30', accuracy: 'EXACT' } },
    { color: ' ' },
  ])('returns 422 INVALID_PET for domain-invalid body %#', async (body) => {
    const response = await patch(body).expect(422);
    expect(response.body).toMatchObject({ code: 'INVALID_PET' });
  });

  it('hides all inaccessible pets as PET_NOT_FOUND', async () => {
    const expected = { code: 'PET_NOT_FOUND', message: 'Pet was not found' };
    expect(
      (await patch({ name: 'Nala' }, collaborator.accessToken).expect(404))
        .body,
    ).toEqual(expected);
    expect(
      (await patch({ name: 'Nala' }, outsider.accessToken).expect(404)).body,
    ).toEqual(expected);
    expect(
      (
        await patch({ name: 'Nala' }, owner.accessToken, randomUUID()).expect(
          404,
        )
      ).body,
    ).toEqual(expected);
    await databaseService.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, ownerMembershipId));
    expect((await patch({ name: 'Nala' }).expect(404)).body).toEqual(expected);
    await databaseService.connection
      .update(petMemberships)
      .set({ status: 'ACTIVE' })
      .where(eq(petMemberships.id, ownerMembershipId));
    await databaseService.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, petId));
    expect((await patch({ name: 'Nala' }).expect(404)).body).toEqual(expected);
  });

  it('rejects invalid and nil IDs and missing authentication', async () => {
    expect(
      (await patch({ name: 'Nala' }, owner.accessToken, 'invalid').expect(400))
        .body,
    ).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(
      (
        await patch(
          { name: 'Nala' },
          owner.accessToken,
          '00000000-0000-0000-0000-000000000000',
        ).expect(400)
      ).body,
    ).toMatchObject({ code: 'INVALID_REQUEST' });
    const unauthenticated = await request(application.getHttpServer())
      .patch(`/pets/${petId}`)
      .send({ name: 'Nala' })
      .expect(401);
    expect(unauthenticated.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
  });
});

describe('GET /pets (e2e)', () => {
  let application: INestApplication<App>;
  let databaseService: DatabaseService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture.createNestApplication();
    await application.init();
    databaseService = application.get(DatabaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  it('lists the authenticated account active and archived pets in name order', async () => {
    const accountA: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'list-owner-a',
    );
    const accountB: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'list-owner-b',
    );
    const createdPetIds: string[] = [];

    try {
      for (const name of ['Rocky', 'Luna']) {
        const response = await request(application.getHttpServer())
          .post('/pets')
          .set('Authorization', `Bearer ${accountA.accessToken}`)
          .send({ ...validPetRequest(), name })
          .expect(201);
        const pet: RegisteredPet = response.body as RegisteredPet;
        createdPetIds.push(pet.id);
      }

      const response = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${accountA.accessToken}`)
        .expect(200);
      const summaries: AccessiblePetSummary[] =
        response.body as AccessiblePetSummary[];

      expect(summaries).toEqual([
        {
          id: createdPetIds[1],
          name: 'Luna',
          species: 'DOG',
          breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
          sex: 'FEMALE',
          role: 'OWNER',
          status: 'ACTIVE',
        },
        {
          id: createdPetIds[0],
          name: 'Rocky',
          species: 'DOG',
          breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
          sex: 'FEMALE',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      ]);

      const ignoredAccountIdResponse = await request(
        application.getHttpServer(),
      )
        .get('/pets')
        .query({ accountId: accountB.accountId })
        .set('Authorization', `Bearer ${accountA.accessToken}`)
        .expect(200);
      expect(ignoredAccountIdResponse.body).toEqual(summaries);

      const otherAccountResponse = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${accountB.accessToken}`)
        .expect(200);
      expect(otherAccountResponse.body).toEqual([]);

      await databaseService.connection
        .update(pets)
        .set({ status: 'ARCHIVED' })
        .where(eq(pets.id, createdPetIds[0]));

      const activeResponse = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${accountA.accessToken}`)
        .expect(200);
      expect(activeResponse.body).toEqual([
        summaries[0],
        { ...summaries[1], status: 'ARCHIVED' },
      ]);
    } finally {
      for (const petId of createdPetIds) {
        await databaseService.connection
          .delete(petMemberships)
          .where(eq(petMemberships.petId, petId));
        await databaseService.connection.delete(pets).where(eq(pets.id, petId));
      }

      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, accountA.accountId));
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, accountB.accountId));
    }
  });

  it('returns an empty list for an authenticated account without pets', async () => {
    const fixture: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'list-empty',
    );

    try {
      const response = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${fixture.accessToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, fixture.accountId));
    }
  });

  it('returns unauthenticated without Authorization', async () => {
    const response = await request(application.getHttpServer())
      .get('/pets')
      .expect(401);

    expect(response.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
  });

  it('returns unauthenticated for an invalid JWT', async () => {
    const response = await request(application.getHttpServer())
      .get('/pets')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    expect(response.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
  });
});

describe('GET /pets/:petId (e2e)', () => {
  let application: INestApplication<App>;
  let databaseService: DatabaseService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture.createNestApplication();
    await application.init();
    databaseService = application.get(DatabaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  it('returns active and archived owner detail while concealing other accounts', async () => {
    const accountA: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'detail-owner-a',
    );
    const accountB: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'detail-owner-b',
    );
    let petId: string | undefined;

    try {
      const registrationResponse = await request(application.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${accountA.accessToken}`)
        .send({
          ...validPetRequest(),
          color: 'Golden',
          distinctiveMarks: 'White paw',
          microchip: '985141000000001',
        })
        .expect(201);
      const registeredPet: RegisteredPet =
        registrationResponse.body as RegisteredPet;
      petId = registeredPet.id;

      const detailResponse = await request(application.getHttpServer())
        .get(`/pets/${petId}`)
        .set('Authorization', `Bearer ${accountA.accessToken}`)
        .expect(200);
      const detail: PetDetail = detailResponse.body as PetDetail;
      expect(detail).toEqual({
        id: petId,
        name: 'Luna',
        species: 'DOG',
        breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
        sex: 'FEMALE',
        birthInformation: { date: '2021-06-14', accuracy: 'EXACT' },
        color: 'Golden',
        distinctiveMarks: 'White paw',
        microchip: '985141000000001',
        status: 'ACTIVE',
        role: 'OWNER',
      });

      const nonexistentResponse = await request(application.getHttpServer())
        .get(`/pets/${randomUUID()}`)
        .set('Authorization', `Bearer ${accountB.accessToken}`)
        .expect(404);
      expect(nonexistentResponse.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });

      const inaccessibleResponse = await request(application.getHttpServer())
        .get(`/pets/${petId}`)
        .set('Authorization', `Bearer ${accountB.accessToken}`)
        .expect(404);
      expect(inaccessibleResponse.body).toEqual(nonexistentResponse.body);

      await databaseService.connection
        .update(pets)
        .set({ status: 'ARCHIVED' })
        .where(eq(pets.id, petId));

      const archivedResponse = await request(application.getHttpServer())
        .get(`/pets/${petId}`)
        .set('Authorization', `Bearer ${accountA.accessToken}`)
        .expect(200);
      expect(archivedResponse.body).toMatchObject({
        id: petId,
        status: 'ARCHIVED',
        role: 'OWNER',
      });
    } finally {
      if (petId !== undefined) {
        await databaseService.connection
          .delete(petMemberships)
          .where(eq(petMemberships.petId, petId));
        await databaseService.connection.delete(pets).where(eq(pets.id, petId));
      }

      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, accountA.accountId));
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, accountB.accountId));
    }
  });

  it('excludes a pet after its membership becomes inactive', async () => {
    const account: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'detail-inactive',
    );
    let petId: string | undefined;

    try {
      const registrationResponse = await request(application.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send(validPetRequest())
        .expect(201);
      const registeredPet: RegisteredPet =
        registrationResponse.body as RegisteredPet;
      petId = registeredPet.id;

      const activeListResponse = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      const activeSummaries: AccessiblePetSummary[] =
        activeListResponse.body as AccessiblePetSummary[];
      expect(activeSummaries.map((summary) => summary.id)).toEqual([petId]);

      const activeDetailResponse = await request(application.getHttpServer())
        .get(`/pets/${petId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(activeDetailResponse.body).toMatchObject({
        id: petId,
        role: 'OWNER',
      });

      await databaseService.connection
        .update(petMemberships)
        .set({ status: 'INACTIVE' })
        .where(eq(petMemberships.petId, petId));

      const inactiveListResponse = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(inactiveListResponse.body).toEqual([]);

      const inactiveDetailResponse = await request(application.getHttpServer())
        .get(`/pets/${petId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(404);
      expect(inactiveDetailResponse.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });
    } finally {
      if (petId !== undefined) {
        await databaseService.connection
          .delete(petMemberships)
          .where(eq(petMemberships.petId, petId));
        await databaseService.connection.delete(pets).where(eq(pets.id, petId));
      }

      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, account.accountId));
    }
  });

  it('requires authentication and rejects a malformed pet id', async () => {
    const petId: string = randomUUID();
    const unauthenticatedResponse = await request(application.getHttpServer())
      .get(`/pets/${petId}`)
      .expect(401);
    expect(unauthenticatedResponse.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });

    const invalidTokenResponse = await request(application.getHttpServer())
      .get(`/pets/${petId}`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
    expect(invalidTokenResponse.body).toEqual(unauthenticatedResponse.body);

    const account: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'detail-invalid-id',
    );

    try {
      const invalidIdResponse = await request(application.getHttpServer())
        .get('/pets/not-a-uuid')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(400);
      expect(invalidIdResponse.body).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, account.accountId));
    }
  });
});

describe('POST /pets/:petId/invitations (e2e)', () => {
  let application: INestApplication<App>;
  let databaseService: DatabaseService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture.createNestApplication();
    await application.init();
    databaseService = application.get(DatabaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  it('creates an invitation only for the active owner and enforces public errors', async () => {
    const owner: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'invite-owner',
    );
    const collaborator: AuthenticatedAccountFixture =
      await registerAndAuthenticate(application, 'invite-collaborator');
    const outsider: AuthenticatedAccountFixture = await registerAndAuthenticate(
      application,
      'invite-outsider',
    );
    let petId: string | undefined;

    try {
      const petResponse = await request(application.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send(validPetRequest())
        .expect(201);
      petId = (petResponse.body as RegisteredPet).id;

      await databaseService.connection.insert(petMemberships).values({
        id: randomUUID(),
        petId,
        accountId: collaborator.accountId,
        role: 'COLLABORATOR',
        status: 'ACTIVE',
      });

      const invitedEmail: string = `new-${randomUUID()}@example.com`;
      const response = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: `  ${invitedEmail.toUpperCase()}  ` })
        .expect(201);
      const invitation: CreatedPetInvitation =
        response.body as CreatedPetInvitation;
      expect(invitation).toEqual({
        id: expect.any(String) as string,
        petId,
        email: invitedEmail,
        status: 'PENDING',
        createdAt: expect.any(String) as string,
        expiresAt: expect.any(String) as string,
      });
      expect(
        new Date(invitation.expiresAt).getTime() -
          new Date(invitation.createdAt).getTime(),
      ).toBe(604_800_000);

      const saved = await databaseService.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.id, invitation.id));
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        petId,
        invitedEmail,
        invitedByAccountId: owner.accountId,
        status: 'PENDING',
      });

      const duplicateResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitedEmail })
        .expect(409);
      expect(duplicateResponse.body).toEqual({
        code: 'INVITATION_ALREADY_PENDING',
        message: 'An invitation is already pending for this email',
      });

      for (const memberEmail of [owner.email, collaborator.email]) {
        const memberResponse = await request(application.getHttpServer())
          .post(`/pets/${petId}/invitations`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ email: memberEmail })
          .expect(409);
        expect(memberResponse.body).toEqual({
          code: 'ALREADY_PET_MEMBER',
          message: 'Account is already a member of this pet',
        });
      }

      const outsiderResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ email: invitedEmail })
        .expect(404);
      expect(outsiderResponse.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });

      const collaboratorResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${collaborator.accessToken}`)
        .send({ email: invitedEmail })
        .expect(404);
      expect(collaboratorResponse.body).toEqual(outsiderResponse.body);

      const unauthenticatedResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .send({ email: invitedEmail })
        .expect(401);
      expect(unauthenticatedResponse.body).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required',
      });

      const invalidPathResponse = await request(application.getHttpServer())
        .post('/pets/not-a-uuid/invitations')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitedEmail })
        .expect(400);
      expect(invalidPathResponse.body).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });

      const invalidBodyResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitedEmail, role: 'OWNER' })
        .expect(400);
      expect(invalidBodyResponse.body).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });

      const invalidEmailResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: 'invalid' })
        .expect(422);
      expect(invalidEmailResponse.body).toEqual({
        code: 'INVALID_EMAIL',
        message: 'Email format is invalid',
      });

      const missingPetResponse = await request(application.getHttpServer())
        .post(`/pets/${randomUUID()}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitedEmail })
        .expect(404);
      expect(missingPetResponse.body).toEqual(outsiderResponse.body);

      await databaseService.connection
        .update(pets)
        .set({ status: 'ARCHIVED' })
        .where(eq(pets.id, petId));
      const archivedPetResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitedEmail })
        .expect(404);
      expect(archivedPetResponse.body).toEqual(outsiderResponse.body);

      await databaseService.connection
        .update(pets)
        .set({ status: 'ACTIVE' })
        .where(eq(pets.id, petId));
      await databaseService.connection.insert(petMemberships).values({
        id: randomUUID(),
        petId,
        accountId: outsider.accountId,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      await databaseService.connection
        .update(petMemberships)
        .set({ status: 'INACTIVE' })
        .where(
          and(
            eq(petMemberships.petId, petId),
            eq(petMemberships.accountId, owner.accountId),
          ),
        );
      const inactiveOwnerResponse = await request(application.getHttpServer())
        .post(`/pets/${petId}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invitedEmail })
        .expect(404);
      expect(inactiveOwnerResponse.body).toEqual(outsiderResponse.body);
    } finally {
      if (petId !== undefined) {
        await databaseService.connection
          .delete(petInvitations)
          .where(eq(petInvitations.petId, petId));
        await databaseService.connection
          .delete(petMemberships)
          .where(eq(petMemberships.petId, petId));
        await databaseService.connection.delete(pets).where(eq(pets.id, petId));
      }

      for (const account of [owner, collaborator, outsider]) {
        await databaseService.connection
          .delete(accounts)
          .where(eq(accounts.id, account.accountId));
      }
    }
  });
});
