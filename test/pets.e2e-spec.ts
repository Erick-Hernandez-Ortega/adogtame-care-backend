import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import type { RegisteredPet } from '../src/pet-management/application/register-pet/register-pet.types';
import {
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
        })
        .from(petMemberships)
        .where(eq(petMemberships.petId, body.id));

      expect(savedMemberships).toEqual([
        { accountId: fixture.accountId, role: 'OWNER' },
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
