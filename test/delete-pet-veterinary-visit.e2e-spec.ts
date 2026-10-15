import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import type { RecordedPetVeterinaryVisit } from '../src/health/application/record-pet-veterinary-visit/record-pet-veterinary-visit';
import type { PetVeterinaryVisits } from '../src/health/application/list-pet-veterinary-visits/list-pet-veterinary-visits';
import { AppModule } from '../src/app.module';
import { healthPetVeterinaryVisits } from '../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface RegisteredAccount {
    id: string;
}

interface LoginResponse {
    accessToken: string;
}

interface AccountFixture {
    id: string;
    token: string;
}

describe('DELETE /pets/:petId/health/veterinary-visits/:visitId (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let collaboratorMembershipId: string;
    let visitId: string;
    let otherPetId: string;

    async function createAccount(): Promise<AccountFixture> {
        const email: string = `${randomUUID()}@example.com`;
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
            id: (registration.body as RegisteredAccount).id,
            token: (login.body as LoginResponse).accessToken,
        };
    }

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture.createNestApplication();
        await application.init();
        database = application.get(DatabaseService);
        owner = await createAccount();
        collaborator = await createAccount();
        outsider = await createAccount();
    });

    afterAll(async () => {
        for (const account of [owner, collaborator, outsider]) {
            await database.connection.delete(accounts).where(eq(accounts.id, account.id));
        }

        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
        otherPetId = randomUUID();
        collaboratorMembershipId = randomUUID();
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((identifier: string) => ({
                id: identifier,
                name: 'Visit pet',
                species: 'DOG',
                breedName: 'Mixed',
                breedKind: 'CUSTOM',
                sex: 'UNKNOWN',
                birthDate: '2020-01-01',
                birthDateAccuracy: 'EXACT',
                status: 'ACTIVE',
            })),
        );
        await database.connection.insert(petMemberships).values([
            {
                id: randomUUID(),
                petId,
                accountId: owner.id,
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
        const created = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(201);

        visitId = (created.body as RecordedPetVeterinaryVisit).id;
    });

    afterEach(async () => {
        await database.connection
            .delete(healthPetVeterinaryVisits)
            .where(inArray(healthPetVeterinaryVisits.petId, [petId, otherPetId]));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
    });

    function path(targetPetId: string = petId): string {
        return `/pets/${targetPetId}/health/veterinary-visits`;
    }

    function body() {
        return {
            reason: '  Annual checkup  ',
            visitDate: '2026-03-14',
            diagnosis: null,
            observations: '  Routine examination.  ',
        };
    }

    function deletePath(targetPetId: string = petId, targetVisitId: string = visitId): string {
        return `${path(targetPetId)}/${targetVisitId}`;
    }

    function remove(account: AccountFixture = owner, target: string = deletePath()) {
        return request(application.getHttpServer())
            .delete(target)
            .set('Authorization', `Bearer ${account.token}`);
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns empty 204 for %s and removes the last record from List',
        async (role) => {
            const response = await remove(role === 'owner' ? owner : collaborator).expect(204);

            expect(response.text).toBe('');
            const listed = await request(application.getHttpServer())
                .get(path())
                .set('Authorization', `Bearer ${owner.token}`)
                .expect(200);

            expect(listed.body).toEqual({ items: [] });
            expect((await remove().expect(404)).body).toMatchObject({
                code: 'PET_VETERINARY_VISIT_NOT_FOUND',
            });
        },
    );

    it('accepts an empty JSON object without a functional payload', async () => {
        const response = await remove().send({}).expect(204);

        expect(response.text).toBe('');
    });

    it('deletes only the requested duplicate', async () => {
        const created = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(201);
        const duplicateId: string = (created.body as RecordedPetVeterinaryVisit).id;

        await remove().expect(204);
        const listed = await request(application.getHttpServer())
            .get(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect(listed.body).toEqual({
            items: [
                {
                    id: duplicateId,
                    reason: 'Annual checkup',
                    visitDate: '2026-03-14',
                    diagnosis: null,
                    observations: 'Routine examination.',
                    recordedByAccountId: owner.id,
                },
            ],
        });
    });

    it('hides inaccessible Pets and scopes target resolution to the authorized Pet', async () => {
        expect((await remove(owner, deletePath(randomUUID())).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect((await remove(outsider).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect(
            (await remove(outsider, deletePath(petId, randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            (await remove(owner, deletePath(petId, randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_VETERINARY_VISIT_NOT_FOUND' });
        const otherVisitId: string = randomUUID();

        await database.connection.insert(healthPetVeterinaryVisits).values({
            id: otherVisitId,
            petId: otherPetId,
            reason: 'Other visit',
            visitDate: '2026-03-14',
            recordedByAccountId: owner.id,
        });
        expect(
            (await remove(owner, deletePath(petId, otherVisitId)).expect(404)).body,
        ).toMatchObject({ code: 'PET_VETERINARY_VISIT_NOT_FOUND' });
        expect(
            (await remove(owner, deletePath(otherPetId, otherVisitId)).expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        expect((await remove(collaborator).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect((await remove().expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        const listed = await request(application.getHttpServer())
            .get(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect((listed.body as PetVeterinaryVisits).items.map((visit) => visit.id)).toEqual([
            visitId,
        ]);
    });

    it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid/nil UUID %s in either path parameter',
        async (identifier: string) => {
            for (const target of [deletePath(identifier), deletePath(petId, identifier)]) {
                expect((await remove(owner, target).expect(400)).body).toMatchObject({
                    code: 'INVALID_REQUEST',
                });
            }
        },
    );

    it('rejects unexpected queries before checking Pet access', async () => {
        for (const query of ['?limit=1', '?extra=', '?status=ACTIVE', '?extra=x&extra=y']) {
            expect((await remove(outsider, deletePath() + query).expect(400)).body).toMatchObject({
                code: 'INVALID_REQUEST',
            });
        }
    });

    it.each(['{"extra":true}', '[]', '[{}]', 'null', '42', 'true', '"text"', '{'])(
        'rejects invalid JSON body %s before checking Pet access',
        async (payload: string) => {
            const response = await remove(outsider)
                .set('Content-Type', 'application/json')
                .send(payload)
                .expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
            const remaining = await database.connection
                .select({ id: healthPetVeterinaryVisits.id })
                .from(healthPetVeterinaryVisits)
                .where(eq(healthPetVeterinaryVisits.id, visitId));

            expect(remaining).toEqual([{ id: visitId }]);
        },
    );

    it('requires authentication before path, query and body validation', async () => {
        for (const token of [undefined, 'invalid-token']) {
            const action = request(application.getHttpServer())
                .delete(deletePath('invalid', 'invalid') + '?extra=true')
                .send({ extra: true });

            if (token !== undefined) {
                action.set('Authorization', `Bearer ${token}`);
            }

            expect((await action.expect(401)).body).toMatchObject({
                code: 'UNAUTHENTICATED',
            });
        }
    });

    it.each(['null', '42', 'true', '"text"', '{'])(
        'authenticates before JSON parser rejection for %s',
        async (payload: string) => {
            for (const token of [undefined, 'invalid-token']) {
                const action = request(application.getHttpServer())
                    .delete(deletePath('invalid', 'invalid') + '?extra=true')
                    .set('Content-Type', 'application/json')
                    .send(payload);

                if (token !== undefined) {
                    action.set('Authorization', `Bearer ${token}`);
                }

                expect((await action.expect(401)).body).toMatchObject({
                    code: 'UNAUTHENTICATED',
                });
            }
        },
    );
    it.each([
        'reason',
        'visitDate',
        'diagnosis',
        'observations',
        'id',
        'petId',
        'recordedByAccountId',
        'status',
        'medicalConditionId',
        'createdAt',
        'updatedAt',
    ])('rejects field %s in a functional DELETE body before access', async (field: string) => {
        const response = await remove(outsider)
            .send({ [field]: null })
            .expect(400);

        expect(response.body).toEqual({
            code: 'INVALID_REQUEST',
            message: 'Request body is invalid',
        });
    });
});
