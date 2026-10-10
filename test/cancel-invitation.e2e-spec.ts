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
    email: string;
    token: string;
}

describe('POST /pet-invitations/:invitationId/cancel (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let otherOwner: AccountFixture;
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

    async function invitation(
        status = 'PENDING',
        createdAt = new Date(Date.now() - 86_400_000),
    ): Promise<string> {
        const id = randomUUID();

        await database.connection.insert(petInvitations).values({
            id,
            petId,
            invitedEmail: recipient.email,
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
        owner = await account('cancel-owner');
        otherOwner = await account('cancel-other-owner');
        recipient = await account('cancel-recipient');
        outsider = await account('cancel-outsider');
    });

    afterAll(async () => {
        for (const fixture of [owner, otherOwner, recipient, outsider]) {
            await database.connection.delete(accounts).where(eq(accounts.id, fixture.id));
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
        await database.connection.delete(petInvitations).where(eq(petInvitations.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
    });

    it('allows either active owner to cancel and retry without changing recipient membership', async () => {
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId,
            accountId: otherOwner.id,
            role: 'OWNER',
            status: 'ACTIVE',
        });
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId,
            accountId: recipient.id,
            role: 'COLLABORATOR',
            status: 'INACTIVE',
        });
        const id = await invitation();
        const path = `/pet-invitations/${id}/cancel`;
        const first = await request(application.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${otherOwner.token}`)
            .expect(200);

        expect(first.body).toEqual({ id, petId, status: 'CANCELLED' });
        const retry = await request(application.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({})
            .expect(200);

        expect(retry.body).toEqual(first.body);
        const rows = await database.connection
            .select()
            .from(petMemberships)
            .where(
                and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, recipient.id)),
            );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ role: 'COLLABORATOR', status: 'INACTIVE' });
    });

    it('distinguishes a missing invitation from an inaccessible pet', async () => {
        const id = await invitation();
        const missing = await request(application.getHttpServer())
            .post(`/pet-invitations/${randomUUID()}/cancel`)
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(404);

        expect(missing.body).toMatchObject({
            code: 'INVITATION_NOT_FOUND',
            message: 'Invitation was not found',
        });
        const hidden = await request(application.getHttpServer())
            .post(`/pet-invitations/${id}/cancel`)
            .set('Authorization', `Bearer ${outsider.token}`)
            .expect(404);

        expect(hidden.body).toMatchObject({
            code: 'PET_NOT_FOUND',
            message: 'Pet was not found',
        });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        const archived = await request(application.getHttpServer())
            .post(`/pet-invitations/${id}/cancel`)
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(404);

        expect(archived.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    });

    it('returns conflict for accepted and rejected invitations and gone for expired', async () => {
        for (const status of ['ACCEPTED', 'REJECTED'] as const) {
            const id = await invitation(status);
            const response = await request(application.getHttpServer())
                .post(`/pet-invitations/${id}/cancel`)
                .set('Authorization', `Bearer ${owner.token}`)
                .expect(409);

            expect(response.body).toMatchObject({ code: 'INVITATION_NOT_PENDING' });
        }

        const id = await invitation('PENDING', new Date(Date.now() - 604_800_000));
        const expired = await request(application.getHttpServer())
            .post(`/pet-invitations/${id}/cancel`)
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(410);

        expect(expired.body).toMatchObject({ code: 'INVITATION_EXPIRED' });
    });

    it('requires authentication, a UUID, and an empty body', async () => {
        const id = await invitation();
        const path = `/pet-invitations/${id}/cancel`;
        const unauthenticated = await request(application.getHttpServer()).post(path).expect(401);

        expect(unauthenticated.body).toMatchObject({ code: 'UNAUTHENTICATED' });
        const invalidId = await request(application.getHttpServer())
            .post('/pet-invitations/invalid/cancel')
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(400);

        expect(invalidId.body).toMatchObject({ code: 'INVALID_REQUEST' });
        const invalidBody = await request(application.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ accountId: outsider.id })
            .expect(400);

        expect(invalidBody.body).toMatchObject({ code: 'INVALID_REQUEST' });
    });
});
