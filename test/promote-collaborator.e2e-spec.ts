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

describe('POST /pets/:petId/members/:membershipId/promote (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petIds: string[];
    let petId: string;
    let membershipId: string;

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
        };
    }

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = moduleFixture.createNestApplication();
        await application.init();
        database = application.get(DatabaseService);
        owner = await account('promote-owner');
        collaborator = await account('promote-collaborator');
        outsider = await account('promote-outsider');
    });

    afterAll(async () => {
        for (const fixture of [owner, collaborator, outsider]) {
            await database.connection.delete(accounts).where(eq(accounts.id, fixture.id));
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

    async function addMember(
        role: 'OWNER' | 'COLLABORATOR' = 'COLLABORATOR',
        status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
    ): Promise<void> {
        await database.connection.insert(petMemberships).values({
            id: membershipId,
            petId,
            accountId: collaborator.id,
            role,
            status,
        });
    }

    async function ownerMembershipId(): Promise<string> {
        const rows = await database.connection
            .select({ id: petMemberships.id })
            .from(petMemberships)
            .where(and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, owner.id)));

        return rows[0].id;
    }

    function promoteMember(
        token: string = owner.token,
        targetMembershipId: string = membershipId,
        requestedPetId: string = petId,
    ) {
        return request(application.getHttpServer())
            .post(`/pets/${requestedPetId}/members/${targetMembershipId}/promote`)
            .set('Authorization', `Bearer ${token}`);
    }

    it('promotes, retries with an empty body, and lists the member as owner', async () => {
        await addMember();
        expect((await promoteMember().expect(204)).text).toBe('');
        expect((await promoteMember().send({}).expect(204)).text).toBe('');
        const response = await request(application.getHttpServer())
            .get(`/pets/${petId}/members`)
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect(
            (response.body as { members: { membershipId: string; role: string }[] }).members,
        ).toEqual(
            expect.arrayContaining([expect.objectContaining({ membershipId, role: 'OWNER' })]),
        );
        await promoteMember(owner.token, await ownerMembershipId()).expect(204);
    });

    it('hides unauthorized, archived, and missing pets before target resolution', async () => {
        await addMember();

        for (const token of [collaborator.token, outsider.token]) {
            const response = await promoteMember(token, randomUUID()).expect(404);

            expect(response.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        }

        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect((await promoteMember().expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect(
            (await promoteMember(owner.token, membershipId, randomUUID()).expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
    });

    it('rejects missing and cross-pet targets after owner authorization', async () => {
        expect((await promoteMember().expect(404)).body).toMatchObject({
            code: 'PET_MEMBER_NOT_FOUND',
        });
        const otherPetId: string = randomUUID();

        petIds.push(otherPetId);
        await database.connection.insert(pets).values({
            id: otherPetId,
            name: 'Other',
            species: 'CAT',
            breedName: 'Mixed',
            breedKind: 'CUSTOM',
            sex: 'UNKNOWN',
            birthDate: '2020-01-01',
            birthDateAccuracy: 'EXACT',
            status: 'ACTIVE',
        });
        await database.connection.insert(petMemberships).values({
            id: membershipId,
            petId: otherPetId,
            accountId: collaborator.id,
            role: 'COLLABORATOR',
            status: 'ACTIVE',
        });
        expect((await promoteMember().expect(404)).body).toMatchObject({
            code: 'PET_MEMBER_NOT_FOUND',
        });
    });

    it.each(['COLLABORATOR', 'OWNER'] as const)('rejects inactive %s', async (role) => {
        await addMember(role, 'INACTIVE');
        expect((await promoteMember().expect(409)).body).toMatchObject({
            code: 'PET_MEMBER_INACTIVE',
        });
    });

    it('validates authentication, UUIDs, query, and body', async () => {
        await addMember();
        await request(application.getHttpServer())
            .post(`/pets/${petId}/members/${membershipId}/promote`)
            .expect(401);

        for (const [requestedPetId, targetMembershipId] of [
            ['invalid', membershipId],
            ['00000000-0000-0000-0000-000000000000', membershipId],
            [petId, 'invalid'],
            [petId, '00000000-0000-0000-0000-000000000000'],
        ]) {
            expect(
                (await promoteMember(owner.token, targetMembershipId, requestedPetId).expect(400))
                    .body,
            ).toMatchObject({ code: 'INVALID_REQUEST' });
        }

        expect((await promoteMember().query({ foo: 'bar' }).expect(400)).body).toMatchObject({
            code: 'INVALID_REQUEST',
        });
        expect((await promoteMember().send({ foo: 'bar' }).expect(400)).body).toMatchObject({
            code: 'INVALID_REQUEST',
        });
    });
});
