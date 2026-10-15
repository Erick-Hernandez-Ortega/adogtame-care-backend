import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { CLOCK } from '../src/pet-management/application/time/clock';
import { AccountId } from '../src/pet-management/domain/pet-membership/pet-membership';
import {
    InvitedEmail,
    PetInvitation,
} from '../src/pet-management/domain/pet-invitation/pet-invitation';
import { PetId } from '../src/pet-management/domain/pet/pet';
import { DrizzlePetInvitationRepository } from '../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet-invitation.repository';
import {
    petInvitations,
    petMemberships,
    pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

const NOW: Date = new Date('2026-10-15T12:00:00.000Z');
const BASELINE: Date = new Date('2000-01-01T00:00:00.000Z');

describe('Audit and history with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let repository: DrizzlePetInvitationRepository;
    let petId: string;
    let ownerId: string;
    let recipientId: string;
    let recipientEmail: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(CLOCK)
            .useValue({ now: (): Date => NOW })
            .compile();

        application = fixture;
        database = application.get(DatabaseService);
        repository = application.get(DrizzlePetInvitationRepository);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
        ownerId = randomUUID();
        recipientId = randomUUID();
        recipientEmail = `${recipientId}@example.com`;
        await database.connection.insert(accounts).values([
            { id: ownerId, email: `${ownerId}@example.com`, passwordHash: 'test-hash' },
            { id: recipientId, email: recipientEmail, passwordHash: 'test-hash' },
        ]);
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Audit pet',
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
            petId,
            accountId: ownerId,
            role: 'OWNER',
            status: 'ACTIVE',
        });
    });

    afterEach(async () => {
        await database.connection.delete(petInvitations).where(eq(petInvitations.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
        await database.connection.delete(accounts).where(eq(accounts.id, recipientId));
        await database.connection.delete(accounts).where(eq(accounts.id, ownerId));
    });

    async function seedInvitation(isExpired: boolean = false): Promise<PetInvitation> {
        const invitation: PetInvitation = PetInvitation.create({
            petId: PetId.from(petId),
            invitedEmail: InvitedEmail.from(recipientEmail),
            invitedByAccountId: AccountId.from(ownerId),
            createdAt: new Date(NOW.getTime() - (isExpired ? 8 : 1) * 86_400_000),
        });

        await database.connection.insert(petInvitations).values({
            id: invitation.id.value,
            petId,
            invitedEmail: recipientEmail,
            invitedByAccountId: ownerId,
            status: 'PENDING',
            createdAt: new Date(invitation.createdAt),
            expiresAt: new Date(invitation.expiresAt),
            updatedAt: BASELINE,
        });

        return invitation;
    }

    async function readInvitation(
        invitationId: string,
    ): Promise<typeof petInvitations.$inferSelect> {
        const rows = await database.connection
            .select()
            .from(petInvitations)
            .where(eq(petInvitations.id, invitationId));

        expect(rows).toHaveLength(1);

        return rows[0];
    }

    it('has required timestamptz columns and an enabled BEFORE UPDATE row trigger on every table', async () => {
        const rows = await database.connection.execute(sql`
            SELECT tables.table_name,
                count(DISTINCT columns.column_name)::int AS timestamp_count,
                bool_or(triggers.tgenabled = 'O' AND triggers.tgtype = 19
                    AND procedures.proname = 'set_updated_at') AS has_update_trigger
            FROM information_schema.tables AS tables
            JOIN information_schema.columns AS columns
                ON columns.table_schema = tables.table_schema
                AND columns.table_name = tables.table_name
                AND columns.column_name IN ('created_at', 'updated_at')
                AND columns.data_type = 'timestamp with time zone'
                AND columns.is_nullable = 'NO'
            JOIN pg_namespace AS namespaces ON namespaces.nspname = tables.table_schema
            JOIN pg_class AS relations ON relations.relnamespace = namespaces.oid
                AND relations.relname = tables.table_name
            LEFT JOIN pg_trigger AS triggers ON triggers.tgrelid = relations.oid
                AND NOT triggers.tgisinternal
            LEFT JOIN pg_proc AS procedures ON procedures.oid = triggers.tgfoid
            WHERE tables.table_schema = 'public' AND tables.table_type = 'BASE TABLE'
            GROUP BY tables.table_name ORDER BY tables.table_name
        `);

        expect(rows).toEqual(
            [
                'accounts',
                'care_activities',
                'care_routines',
                'health_pet_allergies',
                'health_pet_medical_conditions',
                'health_pet_medications',
                'health_pet_veterinary_visits',
                'health_vaccination_records',
                'health_weight_records',
                'pet_invitations',
                'pet_memberships',
                'pets',
            ].map((tableName: string) => ({
                table_name: tableName,
                timestamp_count: 2,
                has_update_trigger: true,
            })),
        );
    });

    it('defaults invitation update time to transaction time without replacing lifecycle dates', async () => {
        await database.connection.transaction(async (transaction) => {
            const rows = await transaction
                .insert(petInvitations)
                .values({
                    id: randomUUID(),
                    petId,
                    invitedEmail: recipientEmail,
                    invitedByAccountId: ownerId,
                    status: 'PENDING',
                    createdAt: BASELINE,
                    expiresAt: new Date('2000-01-08T00:00:00.000Z'),
                })
                .returning();
            const times = await transaction.execute(sql`
                SELECT updated_at = now() AS has_transaction_time
                FROM pet_invitations WHERE id = ${rows[0].id}::uuid
            `);

            expect(times[0].has_transaction_time).toBe(true);
            expect(rows[0].createdAt).toEqual(BASELINE);
            expect(rows[0].expiresAt.toISOString()).toBe('2000-01-08T00:00:00.000Z');
        });
    });

    it.each(['accept', 'reject', 'cancel'] as const)(
        'timestamps %s and expiry while preserving authorship and no-op retries',
        async (action) => {
            for (const isExpired of [false, true]) {
                const invitation: PetInvitation = await seedInvitation(isExpired);
                const before = await readInvitation(invitation.id.value);
                const act = (): Promise<unknown> => {
                    if (action === 'accept') {
                        return repository.accept(invitation.id.value, recipientEmail, recipientId);
                    }

                    if (action === 'reject') {
                        return repository.reject(invitation.id.value, recipientEmail);
                    }

                    return repository.cancel(invitation.id.value, ownerId);
                };
                const result: unknown = await act();
                const after = await readInvitation(invitation.id.value);
                const statuses = { accept: 'ACCEPTED', reject: 'REJECTED', cancel: 'CANCELLED' };

                expect(after).toEqual({
                    ...before,
                    status: isExpired ? 'EXPIRED' : statuses[action],
                    updatedAt: expect.any(Date) as Date,
                });
                expect(after.updatedAt.getTime()).toBeGreaterThan(BASELINE.getTime());
                expect(await act()).toEqual(result);
                expect(await readInvitation(invitation.id.value)).toEqual(after);
            }
        },
    );

    it('timestamps the expired invitation when replacing it and preserves both identities', async () => {
        const expired: PetInvitation = await seedInvitation(true);
        const before = await readInvitation(expired.id.value);
        const replacement: PetInvitation = PetInvitation.create({
            petId: PetId.from(petId),
            invitedEmail: InvitedEmail.from(recipientEmail),
            invitedByAccountId: AccountId.from(ownerId),
            createdAt: NOW,
        });

        expect(expired.expireIfDue(NOW)).toBe(true);
        expect(await repository.createPending(replacement, expired)).toBe('CREATED');
        const after = await readInvitation(expired.id.value);

        expect(after).toEqual({
            ...before,
            status: 'EXPIRED',
            updatedAt: expect.any(Date) as Date,
        });
        expect(after.updatedAt.getTime()).toBeGreaterThan(BASELINE.getTime());
        expect(await readInvitation(replacement.id.value)).toMatchObject({
            id: replacement.id.value,
            status: 'PENDING',
            invitedByAccountId: ownerId,
            createdAt: NOW,
        });
    });

    it('leaves timestamps intact on denied access and rolls back trigger changes', async () => {
        const invitation: PetInvitation = await seedInvitation();
        const before = await readInvitation(invitation.id.value);

        expect(await repository.cancel(invitation.id.value, randomUUID())).toEqual({
            outcome: 'PET_NOT_FOUND',
        });
        expect(await readInvitation(invitation.id.value)).toEqual(before);
        await expect(
            database.connection.transaction(async (transaction) => {
                const rows = await transaction.execute(sql`
                    UPDATE pet_invitations
                    SET status = 'CANCELLED', updated_at = ${BASELINE.toISOString()}::timestamptz
                    WHERE id = ${invitation.id.value}::uuid
                    RETURNING updated_at = statement_timestamp() AS has_statement_time
                `);

                expect(rows[0].has_statement_time).toBe(true);

                throw new Error('Roll back invitation update');
            }),
        ).rejects.toThrow('Roll back invitation update');
        expect(await readInvitation(invitation.id.value)).toEqual(before);
    });
});
