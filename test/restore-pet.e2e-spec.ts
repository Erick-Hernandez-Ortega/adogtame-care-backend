import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
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
import {
  healthWeightRecords,
  healthVaccinationRecords,
} from '../src/health/infrastructure/persistence/drizzle/health.schema';

interface AccountFixture {
  id: string;
  token: string;
  email: string;
}

describe('POST /pets/:petId/restore (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let owner: AccountFixture;
  let otherOwner: AccountFixture;
  let collaborator: AccountFixture;
  let outsider: AccountFixture;
  let petId: string;
  let collaboratorMembershipId: string;

  async function account(label: string): Promise<AccountFixture> {
    const email: string = `${label}-${randomUUID()}@example.com`;
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
      email,
    };
  }
  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = moduleFixture.createNestApplication();
    await application.init();
    database = application.get(DatabaseService);
    owner = await account('restore-owner');
    otherOwner = await account('restore-other-owner');
    collaborator = await account('restore-collaborator');
    outsider = await account('restore-outsider');
  });
  afterAll(async () => {
    for (const fixture of [owner, otherOwner, collaborator, outsider])
      await database.connection
        .delete(accounts)
        .where(eq(accounts.id, fixture.id));
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
        color: 'Brown',
        distinctiveMarks: 'White paw',
        microchip: 'chip',
      })
      .expect(201);
    petId = (response.body as { id: string }).id;
    collaboratorMembershipId = randomUUID();
    await database.connection.insert(petMemberships).values([
      {
        id: randomUUID(),
        petId,
        accountId: otherOwner.id,
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
    await request(application.getHttpServer())
      .post(`/pets/${petId}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);
  });
  afterEach(async () => {
    await database.connection
      .delete(healthWeightRecords)
      .where(eq(healthWeightRecords.petId, petId));
    await database.connection
      .delete(healthVaccinationRecords)
      .where(eq(healthVaccinationRecords.petId, petId));
    await database.connection
      .delete(petInvitations)
      .where(eq(petInvitations.petId, petId));
    await database.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, petId));
    await database.connection.delete(pets).where(eq(pets.id, petId));
  });

  it('restores and retries without changing timestamps while keeping restored pets navigable', async () => {
    const before = await request(application.getHttpServer())
      .get(`/pets/${petId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const membershipsBefore = await database.connection
      .select()
      .from(petMemberships)
      .where(eq(petMemberships.petId, petId))
      .orderBy(petMemberships.id);
    const response = await request(application.getHttpServer())
      .post(`/pets/${petId}/restore`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);
    expect(response.text).toBe('');
    const restoredRows = await database.connection
      .select()
      .from(pets)
      .where(eq(pets.id, petId));
    for (const fixture of [owner, otherOwner])
      await request(application.getHttpServer())
        .post(`/pets/${petId}/restore`)
        .set('Authorization', `Bearer ${fixture.token}`)
        .send({})
        .expect(204)
        .expect('');
    expect(
      await database.connection.select().from(pets).where(eq(pets.id, petId)),
    ).toEqual(restoredRows);
    expect(
      await database.connection
        .select()
        .from(petMemberships)
        .where(eq(petMemberships.petId, petId))
        .orderBy(petMemberships.id),
    ).toEqual(membershipsBefore);
    for (const fixture of [owner, collaborator]) {
      const detail = await request(application.getHttpServer())
        .get(`/pets/${petId}`)
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(200);
      expect(detail.body).toEqual({
        ...(before.body as object),
        status: 'ACTIVE',
        role: fixture.id === owner.id ? 'OWNER' : 'COLLABORATOR',
      });
      const list = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: petId, status: 'ACTIVE' }),
      ]);
      const members = await request(application.getHttpServer())
        .get(`/pets/${petId}/members`)
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(200);
      expect((members.body as { members: object[] }).members).toHaveLength(3);
    }
  });

  it('preserves historical Health reads and allows a pending invitation after Restore', async () => {
    const authorization: string = `Bearer ${owner.token}`;
    await request(application.getHttpServer())
      .post(`/pets/${petId}/restore`)
      .set('Authorization', authorization)
      .expect(204);
    await request(application.getHttpServer())
      .post(`/pets/${petId}/health/weight-records`)
      .set('Authorization', authorization)
      .send({ weightKg: '12.5', measuredDate: '2026-09-01' })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/pets/${petId}/health/vaccination-records`)
      .set('Authorization', authorization)
      .send({ vaccineName: 'Rabies', appliedDate: '2026-09-01' })
      .expect(201);
    const invitation = await request(application.getHttpServer())
      .post(`/pets/${petId}/invitations`)
      .set('Authorization', authorization)
      .send({ email: outsider.email })
      .expect(201);
    const invitationId: string = (invitation.body as { id: string }).id;
    await request(application.getHttpServer())
      .post(`/pets/${petId}/archive`)
      .set('Authorization', authorization)
      .expect(204);
    const histories: object[] = [];
    for (const resource of ['weight-records', 'vaccination-records']) {
      const history = await request(application.getHttpServer())
        .get(`/pets/${petId}/health/${resource}`)
        .set('Authorization', authorization)
        .expect(200);
      histories.push(history.body as object);
    }
    await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/accept`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(409);
    await request(application.getHttpServer())
      .post(`/pets/${petId}/restore`)
      .set('Authorization', authorization)
      .expect(204);
    for (const [index, resource] of [
      'weight-records',
      'vaccination-records',
    ].entries()) {
      const history = await request(application.getHttpServer())
        .get(`/pets/${petId}/health/${resource}`)
        .set('Authorization', authorization)
        .expect(200);
      expect(history.body).toEqual(histories[index]);
    }
    await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/accept`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(200);
  });

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'conceals %s pets from unauthorized requesters',
    async (status) => {
      if (status === 'ACTIVE')
        await request(application.getHttpServer())
          .post(`/pets/${petId}/restore`)
          .set('Authorization', `Bearer ${owner.token}`)
          .expect(204);
      for (const fixture of [collaborator, outsider]) {
        const response = await request(application.getHttpServer())
          .post(`/pets/${petId}/restore`)
          .set('Authorization', `Bearer ${fixture.token}`)
          .expect(404);
        expect(response.body).toEqual({
          code: 'PET_NOT_FOUND',
          message: 'Pet was not found',
        });
      }
      await request(application.getHttpServer())
        .post(`/pets/${petId}/leave`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(204);
      await request(application.getHttpServer())
        .post(`/pets/${petId}/leave`)
        .set('Authorization', `Bearer ${collaborator.token}`)
        .expect(204);
      for (const fixture of [owner, collaborator]) {
        const response = await request(application.getHttpServer())
          .post(`/pets/${petId}/restore`)
          .set('Authorization', `Bearer ${fixture.token}`)
          .expect(404);
        expect(response.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        await request(application.getHttpServer())
          .get(`/pets/${petId}`)
          .set('Authorization', `Bearer ${fixture.token}`)
          .expect(404);
        const list = await request(application.getHttpServer())
          .get('/pets')
          .set('Authorization', `Bearer ${fixture.token}`)
          .expect(200);
        expect(list.body).toEqual([]);
      }
      const missing = await request(application.getHttpServer())
        .post(`/pets/${randomUUID()}/restore`)
        .set('Authorization', `Bearer ${otherOwner.token}`)
        .expect(404);
      expect(missing.body).toEqual({
        code: 'PET_NOT_FOUND',
        message: 'Pet was not found',
      });
    },
  );

  it.each(['invalid', '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid/nil UUID %s',
    async (id) => {
      const response = await request(application.getHttpServer())
        .post(`/pets/${id}/restore`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    },
  );
  it('validates HTTP structure before resolving access', async () => {
    const query = await request(application.getHttpServer())
      .post(`/pets/${randomUUID()}/restore?unexpected=true`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(400);
    expect(query.body).toMatchObject({ code: 'INVALID_REQUEST' });
    for (const body of [
      { status: 'ARCHIVED' },
      [],
      ['value'],
      { reason: 'unused' },
    ]) {
      const response = await request(application.getHttpServer())
        .post(`/pets/${petId}/restore`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
  it.each(['null', '42', 'true', '"value"', '{'])(
    'rejects scalar JSON body %s',
    async (body) => {
      const response = await request(application.getHttpServer())
        .post(`/pets/${petId}/restore`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    },
  );
  it.each(['null', '42', 'true', '"value"', '{'])(
    'authenticates before scalar JSON validation %s',
    async (body) => {
      const response = await request(application.getHttpServer())
        .post('/pets/invalid/restore?unexpected=true')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    },
  );
  it('authenticates before validation', async () => {
    for (const token of ['', 'Bearer invalid']) {
      const response = await request(application.getHttpServer())
        .post('/pets/invalid/restore?unexpected=true')
        .set('Authorization', token)
        .send({ status: 'ARCHIVED' })
        .expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
});
