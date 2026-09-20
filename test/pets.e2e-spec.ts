import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type { RegisteredPet } from '../src/pet-management/application/register-pet/register-pet.types';

const OWNER_ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';

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

  it('registers a pet and returns 201', async () => {
    const response = await request(application.getHttpServer())
      .post('/pets')
      .send({
        name: 'Luna',
        species: 'DOG',
        breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
        sex: 'FEMALE',
        birthInformation: { date: '2021-06-14', accuracy: 'EXACT' },
        ownerAccountId: OWNER_ACCOUNT_ID,
      })
      .expect(201);
    const body: RegisteredPet = response.body as RegisteredPet;

    try {
      expect(body).toMatchObject({
        name: 'Luna',
        species: 'DOG',
        color: null,
        distinctiveMarks: null,
        microchip: null,
        status: 'ACTIVE',
        memberships: [{ accountId: OWNER_ACCOUNT_ID, role: 'OWNER' }],
      });
    } finally {
      await databaseService.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, body.id));
      await databaseService.connection.delete(pets).where(eq(pets.id, body.id));
    }
  });

  it('returns 400 for an invalid request format', async () => {
    const response = await request(application.getHttpServer())
      .post('/pets')
      .send({ name: 'Luna', unexpected: true })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns 422 when the domain rejects the pet', async () => {
    const response = await request(application.getHttpServer())
      .post('/pets')
      .send({
        name: '   ',
        species: 'CAT',
        breed: { name: 'Domestic shorthair', kind: 'KNOWN' },
        sex: 'UNKNOWN',
        birthInformation: {
          date: '2020-01-01',
          accuracy: 'APPROXIMATE',
        },
        ownerAccountId: OWNER_ACCOUNT_ID,
      })
      .expect(422);

    expect(response.body).toMatchObject({ code: 'INVALID_PET' });
  });
});
