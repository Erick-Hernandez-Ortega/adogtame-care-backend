import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, and } from 'drizzle-orm';
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
  email: string;
  token: string;
}

describe('POST /pet-invitations/:invitationId/accept (e2e)', () => {
  let application: INestApplication<App>;
  let database: DatabaseService;
  let owner: AccountFixture;
  let recipient: AccountFixture;
  let outsider: AccountFixture;
  let petId: string;

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
      email,
      token: (login.body as { accessToken: string }).accessToken,
    };
  }

  async function insertInvitation(
    email: string,
    status = 'PENDING',
    createdAt = new Date(Date.now() - 86_400_000),
  ): Promise<string> {
    const id = randomUUID();
    await database.connection.insert(petInvitations).values({
      id,
      petId,
      invitedEmail: email,
      invitedByAccountId: owner.id,
      status,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 604_800_000),
    });
    return id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = moduleFixture.createNestApplication();
    await application.init();
    database = application.get(DatabaseService);
    owner = await account('accept-owner');
    recipient = await account('accept-recipient');
    outsider = await account('accept-outsider');
  });

  afterAll(async () => {
    for (const fixture of [owner, recipient, outsider]) {
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

  it('accepts, retries, grants collaborator access, hides foreign invitations, and preserves an owner', async () => {
    const invitationResponse = await request(application.getHttpServer())
      .post(`/pets/${petId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: recipient.email })
      .expect(201);
    const invitationId = (invitationResponse.body as { id: string }).id;
    const path = `/pet-invitations/${invitationId}/accept`;

    const foreign = await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
    const missing = await request(application.getHttpServer())
      .post(`/pet-invitations/${randomUUID()}/accept`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
    expect(foreign.body).toEqual({
      code: 'INVITATION_NOT_FOUND',
      message: 'Invitation was not found',
    });
    expect(missing.body).toEqual(foreign.body);

    const first = await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(200);
    const second = await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(200);
    expect(first.body).toEqual({ id: invitationId, petId, status: 'ACCEPTED' });
    expect(second.body).toEqual(first.body);
    const foreignRetry = await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
    expect(foreignRetry.body).toEqual(foreign.body);

    const list = await request(application.getHttpServer())
      .get('/pets')
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(200);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: petId, role: 'COLLABORATOR' }) as object,
      ]),
    );
    const detail = await request(application.getHttpServer())
      .get(`/pets/${petId}`)
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(200);
    expect(detail.body).toMatchObject({ id: petId, role: 'COLLABORATOR' });
    const memberships = await database.connection
      .select()
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, petId),
          eq(petMemberships.accountId, recipient.id),
        ),
      );
    expect(memberships).toHaveLength(1);

    const ownerInvitationId = await insertInvitation(owner.email);
    await request(application.getHttpServer())
      .post(`/pet-invitations/${ownerInvitationId}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const ownerMembership = await database.connection
      .select()
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, petId),
          eq(petMemberships.accountId, owner.id),
        ),
      );
    expect(ownerMembership).toEqual([
      expect.objectContaining({ role: 'OWNER', status: 'ACTIVE' }),
    ]);
  });

  it('persists a due invitation as expired and does not grant access', async () => {
    const invitationId = await insertInvitation(
      recipient.email,
      'PENDING',
      new Date(Date.now() - 8 * 86_400_000),
    );
    const response = await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/accept`)
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(410);
    expect(response.body).toEqual({
      code: 'INVITATION_EXPIRED',
      message: 'Invitation has expired',
    });
    const saved = await database.connection
      .select({ status: petInvitations.status })
      .from(petInvitations)
      .where(eq(petInvitations.id, invitationId));
    expect(saved).toEqual([{ status: 'EXPIRED' }]);
    const memberships = await database.connection
      .select()
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, petId),
          eq(petMemberships.accountId, recipient.id),
        ),
      );
    expect(memberships).toEqual([]);
    await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/accept`)
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(410);
  });

  it('rejects terminal invitations and archived pets with the specified conflicts', async () => {
    for (const status of ['REJECTED', 'CANCELLED']) {
      const invitationId = await insertInvitation(recipient.email, status);
      const response = await request(application.getHttpServer())
        .post(`/pet-invitations/${invitationId}/accept`)
        .set('Authorization', `Bearer ${recipient.token}`)
        .expect(409);
      expect(response.body).toEqual({
        code: 'INVITATION_NOT_PENDING',
        message: 'Invitation is not pending',
      });
    }

    const invitationId = await insertInvitation(recipient.email);
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, petId));
    const response = await request(application.getHttpServer())
      .post(`/pet-invitations/${invitationId}/accept`)
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(409);
    expect(response.body).toEqual({
      code: 'INVITATION_NOT_ACCEPTABLE',
      message: 'Invitation can no longer be accepted',
    });
    const saved = await database.connection
      .select({ status: petInvitations.status })
      .from(petInvitations)
      .where(eq(petInvitations.id, invitationId));
    expect(saved).toEqual([{ status: 'PENDING' }]);
  });

  it('requires authentication and validates the UUID and empty body', async () => {
    const invitationId = await insertInvitation(recipient.email);
    const path = `/pet-invitations/${invitationId}/accept`;
    const unauthenticated = await request(application.getHttpServer())
      .post(path)
      .expect(401);
    expect(unauthenticated.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
    const invalidId = await request(application.getHttpServer())
      .post('/pet-invitations/not-a-uuid/accept')
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(400);
    expect(invalidId.body).toEqual({
      code: 'INVALID_REQUEST',
      message: 'Invitation id is invalid',
    });
    const invalidBody = await request(application.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${recipient.token}`)
      .send({ accountId: outsider.id })
      .expect(400);
    expect(invalidBody.body).toEqual({
      code: 'INVALID_REQUEST',
      message: 'Request body is invalid',
    });
  });
});
