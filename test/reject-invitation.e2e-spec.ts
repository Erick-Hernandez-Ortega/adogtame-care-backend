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

describe('POST /pet-invitations/:invitationId/reject (e2e)', () => {
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
        owner = await account('reject-owner');
        recipient = await account('reject-recipient');
        outsider = await account('reject-outsider');
    });

    afterAll(async () => {
        for (const fixture of [owner, recipient, outsider]) {
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

    it('rejects and retries, while hiding the invitation from another account', async () => {
        const invitationId = await insertInvitation(recipient.email);
        const path = `/pet-invitations/${invitationId}/reject`;
        const foreign = await request(application.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${outsider.token}`)
            .expect(404);
        const missing = await request(application.getHttpServer())
            .post(`/pet-invitations/${randomUUID()}/reject`)
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
        const retry = await request(application.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${recipient.token}`)
            .send({})
            .expect(200);

        expect(first.body).toEqual({ id: invitationId, petId, status: 'REJECTED' });
        expect(retry.body).toEqual(first.body);
        expect(
            (
                await database.connection
                    .select({ status: petInvitations.status })
                    .from(petInvitations)
                    .where(eq(petInvitations.id, invitationId))
            )[0].status,
        ).toBe('REJECTED');
        const memberships = await database.connection
            .select()
            .from(petMemberships)
            .where(
                and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, recipient.id)),
            );

        expect(memberships).toEqual([]);
        await request(application.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${outsider.token}`)
            .expect(404);
    });

    it('materializes expiration and returns 410', async () => {
        const invitationId = await insertInvitation(
            recipient.email,
            'PENDING',
            new Date(Date.now() - 8 * 86_400_000),
        );
        const response = await request(application.getHttpServer())
            .post(`/pet-invitations/${invitationId}/reject`)
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
    });

    it.each(['ACCEPTED', 'CANCELLED'])('returns 409 for %s', async (status) => {
        const invitationId = await insertInvitation(recipient.email, status);
        const response = await request(application.getHttpServer())
            .post(`/pet-invitations/${invitationId}/reject`)
            .set('Authorization', `Bearer ${recipient.token}`)
            .expect(409);

        expect(response.body).toEqual({
            code: 'INVITATION_NOT_PENDING',
            message: 'Invitation is not pending',
        });
    });

    it('rejects even when the pet is archived without changing membership', async () => {
        const invitationId = await insertInvitation(recipient.email);

        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        const membershipId = randomUUID();

        await database.connection.insert(petMemberships).values({
            id: membershipId,
            petId,
            accountId: recipient.id,
            role: 'COLLABORATOR',
            status: 'ACTIVE',
        });
        const before = await database.connection
            .select()
            .from(petMemberships)
            .where(eq(petMemberships.id, membershipId));

        await request(application.getHttpServer())
            .post(`/pet-invitations/${invitationId}/reject`)
            .set('Authorization', `Bearer ${recipient.token}`)
            .expect(200);
        expect(
            await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.id, membershipId)),
        ).toEqual(before);
    });

    it('requires authentication, a UUID, and an empty body', async () => {
        const invitationId = await insertInvitation(recipient.email);
        const path = `/pet-invitations/${invitationId}/reject`;
        const unauthenticated = await request(application.getHttpServer()).post(path).expect(401);

        expect(unauthenticated.body).toEqual({
            code: 'UNAUTHENTICATED',
            message: 'Authentication is required',
        });
        const invalidId = await request(application.getHttpServer())
            .post('/pet-invitations/invalid/reject')
            .set('Authorization', `Bearer ${recipient.token}`)
            .expect(400);

        expect(invalidId.body).toEqual({
            code: 'INVALID_REQUEST',
            message: 'Invitation id is invalid',
        });
        const invalidBody = await request(application.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${recipient.token}`)
            .send({ email: recipient.email })
            .expect(400);

        expect(invalidBody.body).toEqual({
            code: 'INVALID_REQUEST',
            message: 'Request body is invalid',
        });
    });
});
