import { HEALTH_CLOCK } from '../src/health/application/time/clock';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Test as HttpTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { healthPetMedications } from '../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface AccountFixture {
    id: string;
    token: string;
}

describe('Pet medication lifecycle (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let medicationId: string;
    let otherPetId: string;
    let collaboratorMembershipId: string;

    async function createAccount(): Promise<AccountFixture> {
        const email: string = `${randomUUID()}@example.com`;
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
            token: (login.body as { accessToken: string }).accessToken,
        };
    }

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(HEALTH_CLOCK)
            .useValue({ now: (): Date => new Date('2026-10-11T00:00:00Z') })
            .compile();

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
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Medication pet',
            species: 'DOG',
            breedName: 'Mixed',
            breedKind: 'CUSTOM',
            sex: 'UNKNOWN',
            birthDate: '2020-01-01',
            birthDateAccuracy: 'EXACT',
            status: 'ACTIVE',
        });
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
        await database.connection.insert(pets).values({
            id: otherPetId,
            name: 'Other pet',
            species: 'DOG',
            breedName: 'Mixed',
            breedKind: 'CUSTOM',
            sex: 'UNKNOWN',
            birthDate: '2020-01-01',
            birthDateAccuracy: 'EXACT',
            status: 'ACTIVE',
        });
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId: otherPetId,
            accountId: owner.id,
            role: 'OWNER',
            status: 'ACTIVE',
        });
        const recorded = await request(application.getHttpServer())
            .post(`/pets/${petId}/health/medications`)
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(201);

        medicationId = (recorded.body as { id: string }).id;
    });

    afterEach(async () => {
        await database.connection
            .delete(healthPetMedications)
            .where(inArray(healthPetMedications.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
    });

    function path(id: string = petId, target: string = medicationId): string {
        return `/pets/${id}/health/medications/${target}`;
    }

    function body() {
        return {
            name: '  Amoxicillin  ',
            dosage: '  250 mg  ',
            frequency: '  Every 12 hours  ',
            startDate: '2026-10-01',
            plannedEndDate: '2099-10-17',
            notes: '  Give with food  ',
        };
    }

    function patch(account: AccountFixture = owner, target: string = path()): HttpTest {
        return request(application.getHttpServer())
            .patch(target)
            .set('Authorization', `Bearer ${account.token}`);
    }

    async function rows() {
        return database.connection
            .select()
            .from(healthPetMedications)
            .where(eq(healthPetMedications.petId, petId));
    }

    function action(
        name: string,
        account: AccountFixture = collaborator,
        target: string = path(),
    ): HttpTest {
        return request(application.getHttpServer())
            .post(`${target}/${name}`)
            .set('Authorization', `Bearer ${account.token}`);
    }

    it.each(['owner', 'collaborator'] as const)(
        'allows %s to report and correct closures without changing author',
        async (role) => {
            const account: AccountFixture = role === 'owner' ? owner : collaborator;
            const completed = await action('complete', account)
                .send({ endedDate: '2026-10-10' })
                .expect(200);

            expect(completed.body).toMatchObject({
                id: medicationId,
                recordedByAccountId: owner.id,
                status: 'COMPLETED',
                endedDate: '2026-10-10',
                discontinuationReason: null,
            });
            await action('complete', account).send({ endedDate: '2026-10-10' }).expect(200);
            await action('complete', account).send({ endedDate: null }).expect(409);
            await action('discontinue', account).send({ endedDate: null }).expect(409);
            await patch(account).send({ endedDate: null }).expect(200);
            await action('reopen', account).expect(200);
            await action('reopen', account).send({}).expect(200);
            const discontinued = await action('discontinue', account)
                .send({
                    endedDate: '2026-09-01',
                    discontinuationReason: ' Withdrawn before start ',
                })
                .expect(200);

            expect(discontinued.body).toMatchObject({
                status: 'DISCONTINUED',
                endedDate: '2026-09-01',
                discontinuationReason: 'Withdrawn before start',
                recordedByAccountId: owner.id,
            });
            await action('discontinue', account)
                .send({ endedDate: '2026-09-01', discontinuationReason: 'Withdrawn before start' })
                .expect(200);
            await patch(account).send({ discontinuationReason: null }).expect(200);
            const listed = await request(application.getHttpServer())
                .get(`/pets/${petId}/health/medications`)
                .set('Authorization', `Bearer ${account.token}`)
                .expect(200);

            expect(listed.body).toMatchObject({
                items: [{ status: 'DISCONTINUED', discontinuationReason: null }],
            });
            await action('reopen', account).expect(200);
            await action('complete', account).send({ endedDate: null }).expect(200);
            await request(application.getHttpServer())
                .delete(path())
                .set('Authorization', `Bearer ${account.token}`)
                .expect(204);
            await action('reopen', account).expect(404);
        },
    );

    it('supports unknown start and ending without synthesizing dates', async () => {
        await patch().send({ startDate: null }).expect(200);
        const completed = await action('complete').send({ endedDate: null }).expect(200);

        expect(completed.body).toMatchObject({
            status: 'COMPLETED',
            startDate: null,
            endedDate: null,
        });
        await action('reopen').expect(200);
        await patch().send({ startDate: '2099-10-10' }).expect(200);
        await action('discontinue').send({ endedDate: '2026-10-11' }).expect(200);
    });

    it.each(['2026-10-12', '2026-09-30', 'bad', '2026-02-29'])(
        'rejects invalid completion date %s',
        async (endedDate) => {
            const response = await action('complete').send({ endedDate }).expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_MEDICATION_ENDED_DATE' });
            expect((await rows())[0].status).toBe('OPEN');
        },
    );

    it('keeps PATCH distinct from transitions and validates the complete corrected state', async () => {
        await patch().send({ status: 'COMPLETED' }).expect(400);
        await patch().send({ endedDate: null }).expect(409);
        await action('complete').send({ endedDate: '2026-10-10' }).expect(200);
        await patch().send({ startDate: '2026-10-11' }).expect(400);
        await patch().send({ endedDate: '2026-10-12' }).expect(400);
        await patch().send({ discontinuationReason: null }).expect(409);
        await patch().send({ startDate: '2026-10-11', endedDate: '2026-10-11' }).expect(200);
    });

    it('rejects invalid reason text and preserves historical authorship after the author leaves', async () => {
        for (const discontinuationReason of ['', ' ', '🐕'.repeat(2001)]) {
            const invalid = await action('discontinue')
                .send({ endedDate: null, discontinuationReason })
                .expect(400);

            expect(invalid.body).toMatchObject({
                code: 'INVALID_MEDICATION_DISCONTINUATION_REASON',
            });
        }

        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.accountId, owner.id));
        const response = await action('discontinue').send({ endedDate: null }).expect(200);

        expect(response.body).toMatchObject({
            recordedByAccountId: owner.id,
            status: 'DISCONTINUED',
        });
        await action('reopen', owner).expect(404);
    });

    it('resolves medication only within the authorized pet', async () => {
        const response = await action(
            'complete',
            owner,
            `/pets/${otherPetId}/health/medications/${medicationId}`,
        )
            .send({ endedDate: 'bad' })
            .expect(404);

        expect(response.body).toMatchObject({ code: 'PET_MEDICATION_NOT_FOUND' });
    });

    it.each(['complete', 'discontinue', 'reopen'])(
        'preserves authorization and strict HTTP contracts for %s',
        async (name) => {
            const payload = name === 'reopen' ? {} : { endedDate: null };

            await request(application.getHttpServer())
                .post(`${path()}/${name}`)
                .send(payload)
                .expect(401);
            await action(name, outsider).send(payload).expect(404);
            await action(name, collaborator, `/pets/${petId}/health/medications/${randomUUID()}`)
                .send(payload)
                .expect(404);
            await action(name, collaborator, `/pets/bad/health/medications/${medicationId}`)
                .send(payload)
                .expect(400);
            await request(application.getHttpServer())
                .post(`${path()}/${name}?extra=true`)
                .set('Authorization', `Bearer ${collaborator.token}`)
                .send(payload)
                .expect(400);
            await action(name)
                .send({ ...payload, status: 'OPEN' })
                .expect(400);

            for (const invalid of ['null', '[]', '42', '{']) {
                await action(name)
                    .set('Content-Type', 'application/json')
                    .send(invalid)
                    .expect(400);
            }

            if (name !== 'reopen') {
                await action(name).expect(400);
                await action(name).send({}).expect(400);
            }

            await database.connection
                .update(pets)
                .set({ status: 'ARCHIVED' })
                .where(eq(pets.id, petId));
            await action(name).send(payload).expect(404);
            await request(application.getHttpServer())
                .get(`/pets/${petId}/health/medications`)
                .set('Authorization', `Bearer ${collaborator.token}`)
                .expect(200);
        },
    );
});
