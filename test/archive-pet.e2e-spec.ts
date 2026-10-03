import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import {
  healthWeightRecords,
  healthVaccinationRecords,
} from '../src/health/infrastructure/persistence/drizzle/health.schema';

interface AccountFixture {
  id: string;
  token: string;
  email: string;
}

describe('POST /pets/:petId/archive (e2e)', () => {
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
    owner = await account('archive-owner');
    otherOwner = await account('archive-other-owner');
    collaborator = await account('archive-collaborator');
    outsider = await account('archive-outsider');
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

  it('archives and retries without changing timestamps while keeping archived pets navigable', async () => {
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
      .post(`/pets/${petId}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);
    expect(response.text).toBe('');
    const archivedRows = await database.connection
      .select()
      .from(pets)
      .where(eq(pets.id, petId));
    for (const fixture of [owner, otherOwner])
      await request(application.getHttpServer())
        .post(`/pets/${petId}/archive`)
        .set('Authorization', `Bearer ${fixture.token}`)
        .send({})
        .expect(204);
    expect(
      await database.connection.select().from(pets).where(eq(pets.id, petId)),
    ).toEqual(archivedRows);
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
        status: 'ARCHIVED',
        role: fixture.id === owner.id ? 'OWNER' : 'COLLABORATOR',
      });
      const list = await request(application.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: petId, status: 'ARCHIVED' }),
      ]);
      const members = await request(application.getHttpServer())
        .get(`/pets/${petId}/members`)
        .set('Authorization', `Bearer ${fixture.token}`)
        .expect(200);
      expect((members.body as { members: object[] }).members).toHaveLength(3);
    }
  });

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'conceals %s pets from unauthorized requesters',
    async (status) => {
      if (status === 'ARCHIVED')
        await request(application.getHttpServer())
          .post(`/pets/${petId}/archive`)
          .set('Authorization', `Bearer ${owner.token}`)
          .expect(204);
      for (const fixture of [collaborator, outsider]) {
        const response = await request(application.getHttpServer())
          .post(`/pets/${petId}/archive`)
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
          .post(`/pets/${petId}/archive`)
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
        .post(`/pets/${randomUUID()}/archive`)
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
        .post(`/pets/${id}/archive`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    },
  );
  it('validates HTTP structure before resolving access', async () => {
    const query = await request(application.getHttpServer())
      .post(`/pets/${randomUUID()}/archive?unexpected=true`)
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
        .post(`/pets/${petId}/archive`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(body)
        .expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
  it('authenticates before validation', async () => {
    for (const token of ['', 'Bearer invalid']) {
      const response = await request(application.getHttpServer())
        .post('/pets/invalid/archive?unexpected=true')
        .set('Authorization', token)
        .send({ status: 'ARCHIVED' })
        .expect(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('preserves Health and pending invitations, allows historical reads and blocks every administrative/Health write', async () => {
    const authorization: string = `Bearer ${owner.token}`;
    const weight = await request(application.getHttpServer())
      .post(`/pets/${petId}/health/weight-records`)
      .set('Authorization', authorization)
      .send({ weightKg: '12.5', measuredDate: '2026-09-01' })
      .expect(201);
    const vaccination = await request(application.getHttpServer())
      .post(`/pets/${petId}/health/vaccination-records`)
      .set('Authorization', authorization)
      .send({
        vaccineName: 'Rabies',
        appliedDate: '2026-09-01',
        nextDueDate: '2027-09-01',
      })
      .expect(201);
    const invitation = await request(application.getHttpServer())
      .post(`/pets/${petId}/invitations`)
      .set('Authorization', authorization)
      .send({ email: outsider.email })
      .expect(201);
    const invitationId: string = (invitation.body as { id: string }).id;
    const weightId: string = (weight.body as { id: string }).id;
    const vaccinationId: string = (vaccination.body as { id: string }).id;
    const weightsBefore = await database.connection
      .select()
      .from(healthWeightRecords)
      .where(eq(healthWeightRecords.petId, petId));
    const vaccinationsBefore = await database.connection
      .select()
      .from(healthVaccinationRecords)
      .where(eq(healthVaccinationRecords.petId, petId));
    const invitationsBefore = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.petId, petId));
    await request(application.getHttpServer())
      .post(`/pets/${petId}/archive`)
      .set('Authorization', authorization)
      .expect(204);
    for (const fixture of [owner, collaborator]) {
      for (const resource of ['weight-records', 'vaccination-records']) {
        const history = await request(application.getHttpServer())
          .get(`/pets/${petId}/health/${resource}`)
          .set('Authorization', `Bearer ${fixture.token}`)
          .expect(200);
        expect((history.body as { items: object[] }).items).toHaveLength(1);
      }
    }
    const accept = await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/accept`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(409);
    expect(accept.body).toMatchObject({ code: 'INVITATION_NOT_ACCEPTABLE' });
    expect(
      await database.connection
        .select()
        .from(petMemberships)
        .where(
          and(
            eq(petMemberships.petId, petId),
            eq(petMemberships.accountId, outsider.id),
          ),
        ),
    ).toEqual([]);
    const cancel = await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/cancel`)
      .set('Authorization', authorization)
      .expect(404);
    expect(cancel.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    interface WriteRequest {
      method: 'post' | 'patch' | 'delete';
      path: string;
      body: object;
    }
    const writes: WriteRequest[] = [
      { method: 'patch', path: `/pets/${petId}`, body: { name: 'Changed' } },
      {
        method: 'post',
        path: `/pets/${petId}/invitations`,
        body: { email: 'new@example.com' },
      },
      {
        method: 'post',
        path: `/pets/${petId}/members/${collaboratorMembershipId}/promote`,
        body: {},
      },
      {
        method: 'delete',
        path: `/pets/${petId}/members/${collaboratorMembershipId}`,
        body: {},
      },
      {
        method: 'post',
        path: `/pets/${petId}/health/weight-records`,
        body: { weightKg: '13', measuredDate: '2026-09-01' },
      },
      {
        method: 'patch',
        path: `/pets/${petId}/health/weight-records/${weightId}`,
        body: { weightKg: '13' },
      },
      {
        method: 'delete',
        path: `/pets/${petId}/health/weight-records/${weightId}`,
        body: {},
      },
      {
        method: 'post',
        path: `/pets/${petId}/health/vaccination-records`,
        body: { vaccineName: 'Rabies', appliedDate: '2026-09-01' },
      },
      {
        method: 'patch',
        path: `/pets/${petId}/health/vaccination-records/${vaccinationId}`,
        body: { vaccineName: 'Changed' },
      },
      {
        method: 'delete',
        path: `/pets/${petId}/health/vaccination-records/${vaccinationId}`,
        body: {},
      },
    ];
    for (const write of writes) {
      const response = await request(application.getHttpServer())
        [write.method](write.path)
        .set('Authorization', authorization)
        .send(write.body)
        .expect(404);
      expect(response.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    }
    expect(
      await database.connection
        .select()
        .from(healthWeightRecords)
        .where(eq(healthWeightRecords.petId, petId)),
    ).toEqual(weightsBefore);
    expect(
      await database.connection
        .select()
        .from(healthVaccinationRecords)
        .where(eq(healthVaccinationRecords.petId, petId)),
    ).toEqual(vaccinationsBefore);
    expect(
      await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.petId, petId)),
    ).toEqual(invitationsBefore);
    const rejection = await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/reject`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(200);
    expect(rejection.body).toMatchObject({ status: 'REJECTED' });
  });
});
