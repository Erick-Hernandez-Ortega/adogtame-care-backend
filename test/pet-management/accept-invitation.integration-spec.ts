import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
    AcceptInvitation,
    InvitationExpiredError,
    InvitationNotAcceptableError,
} from '../../src/pet-management/application/accept-invitation/accept-invitation';
import { CLOCK } from '../../src/pet-management/application/time/clock';
import { BirthInformation } from '../../src/pet-management/domain/birth-information/birth-information';
import { Breed } from '../../src/pet-management/domain/breed/breed';
import { AccountId } from '../../src/pet-management/domain/pet-membership/pet-membership';
import {
    InvitedEmail,
    PetInvitation,
} from '../../src/pet-management/domain/pet-invitation/pet-invitation';
import { Pet } from '../../src/pet-management/domain/pet/pet';
import { DrizzlePetInvitationRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet-invitation.repository';
import { DrizzlePetRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet.repository';
import {
    petInvitations,
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

const NOW = new Date('2026-09-27T12:30:00.000Z');
const ROLLBACK_INVITATION_ID = '8a5c69ca-d175-4243-9300-df2de444b732';

describe('AcceptInvitation with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let useCase: AcceptInvitation;
    let invitationRepository: DrizzlePetInvitationRepository;
    let pet: Pet;
    let ownerId: string;
    let recipientId: string;
    let recipientEmail: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(CLOCK)
            .useValue({ now: (): Date => NOW })
            .compile();

        application = moduleFixture;
        database = application.get(DatabaseService);
        useCase = application.get(AcceptInvitation);
        invitationRepository = application.get(DrizzlePetInvitationRepository);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        ownerId = randomUUID();
        recipientId = randomUUID();
        recipientEmail = `recipient-${randomUUID()}@example.com`;
        await database.connection.insert(accounts).values({
            id: recipientId,
            email: recipientEmail,
            passwordHash: '$argon2id$test-hash',
        });
        pet = Pet.register({
            name: 'Acceptance pet',
            species: 'DOG',
            breed: Breed.custom('Mixed'),
            sex: 'UNKNOWN',
            birthInformation: BirthInformation.approximate('2020-01-01'),
            ownerAccountId: ownerId,
        });
        await new DrizzlePetRepository(database).save(pet);
    });

    afterEach(async () => {
        await database.connection
            .delete(petInvitations)
            .where(eq(petInvitations.petId, pet.id.value));
        await database.connection
            .delete(petMemberships)
            .where(eq(petMemberships.petId, pet.id.value));
        await database.connection.delete(pets).where(eq(pets.id, pet.id.value));
        await database.connection.delete(accounts).where(eq(accounts.id, recipientId));
    });

    async function createInvitation(
        createdAt: Date = new Date(NOW.getTime() - 86_400_000),
    ): Promise<PetInvitation> {
        const invitation = PetInvitation.create({
            petId: pet.id,
            invitedEmail: InvitedEmail.from(recipientEmail),
            invitedByAccountId: AccountId.from(ownerId),
            createdAt,
        });

        await invitationRepository.createPending(invitation, null);

        return invitation;
    }

    async function recipientMemberships() {
        return database.connection
            .select()
            .from(petMemberships)
            .where(
                and(
                    eq(petMemberships.petId, pet.id.value),
                    eq(petMemberships.accountId, recipientId),
                ),
            );
    }

    it('creates one active collaborator and persists accepted, including an idempotent retry', async () => {
        const invitation = await createInvitation();
        const first = await useCase.execute(invitation.id.value, recipientId);
        const second = await useCase.execute(invitation.id.value, recipientId);

        expect(first).toEqual({
            id: invitation.id.value,
            petId: pet.id.value,
            status: 'ACCEPTED',
        });
        expect(second).toEqual(first);
        const memberships = await recipientMemberships();

        expect(memberships).toHaveLength(1);
        expect(memberships[0]).toMatchObject({
            role: 'COLLABORATOR',
            status: 'ACTIVE',
        });
        const saved = await database.connection
            .select()
            .from(petInvitations)
            .where(eq(petInvitations.id, invitation.id.value));

        expect(saved[0].status).toBe('ACCEPTED');
    });

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'reactivates an inactive %s with the same ID as collaborator',
        async (role) => {
            const invitation = await createInvitation();
            const membershipId = randomUUID();

            await database.connection.insert(petMemberships).values({
                id: membershipId,
                petId: pet.id.value,
                accountId: recipientId,
                role,
                status: 'INACTIVE',
            });
            await useCase.execute(invitation.id.value, recipientId);
            expect(await recipientMemberships()).toEqual([
                expect.objectContaining({
                    id: membershipId,
                    role: 'COLLABORATOR',
                    status: 'ACTIVE',
                }),
            ]);
        },
    );

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'does not change an active %s membership',
        async (role) => {
            const invitation = await createInvitation();
            const membershipId = randomUUID();

            await database.connection.insert(petMemberships).values({
                id: membershipId,
                petId: pet.id.value,
                accountId: recipientId,
                role,
                status: 'ACTIVE',
            });
            const before = (await recipientMemberships())[0];

            await useCase.execute(invitation.id.value, recipientId);
            expect(await recipientMemberships()).toEqual([before]);
        },
    );

    it('persists expiration without creating membership', async () => {
        const invitation = await createInvitation(new Date(NOW.getTime() - 604_800_000));

        await expect(useCase.execute(invitation.id.value, recipientId)).rejects.toThrow(
            InvitationExpiredError,
        );
        expect(await recipientMemberships()).toEqual([]);
        const saved = await database.connection
            .select({ status: petInvitations.status })
            .from(petInvitations)
            .where(eq(petInvitations.id, invitation.id.value));

        expect(saved).toEqual([{ status: 'EXPIRED' }]);
    });

    it('rejects an archived pet without changing invitation or membership', async () => {
        const invitation = await createInvitation();

        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, pet.id.value));
        await expect(useCase.execute(invitation.id.value, recipientId)).rejects.toThrow(
            InvitationNotAcceptableError,
        );
        expect(await recipientMemberships()).toEqual([]);
        const saved = await database.connection
            .select({ status: petInvitations.status })
            .from(petInvitations)
            .where(eq(petInvitations.id, invitation.id.value));

        expect(saved).toEqual([{ status: 'PENDING' }]);
    });

    it('rolls back membership insertion when the invitation update fails', async () => {
        await database.connection.insert(petInvitations).values({
            id: ROLLBACK_INVITATION_ID,
            petId: pet.id.value,
            invitedEmail: recipientEmail,
            invitedByAccountId: ownerId,
            status: 'PENDING',
            createdAt: new Date(NOW.getTime() - 86_400_000),
            expiresAt: new Date(NOW.getTime() + 518_400_000),
        });
        await database.connection.execute(
            sql`ALTER TABLE pet_invitations ADD CONSTRAINT test_accept_rollback CHECK (id <> '8a5c69ca-d175-4243-9300-df2de444b732'::uuid OR status <> 'ACCEPTED')`,
        );

        try {
            await expect(useCase.execute(ROLLBACK_INVITATION_ID, recipientId)).rejects.toThrow();
            expect(await recipientMemberships()).toEqual([]);
            const saved = await database.connection
                .select({ status: petInvitations.status })
                .from(petInvitations)
                .where(eq(petInvitations.id, ROLLBACK_INVITATION_ID));

            expect(saved).toEqual([{ status: 'PENDING' }]);
        } finally {
            await database.connection.execute(
                sql`ALTER TABLE pet_invitations DROP CONSTRAINT test_accept_rollback`,
            );
        }
    });

    it('serializes two concurrent accepts to one membership and two successful results', async () => {
        const invitation = await createInvitation();
        let unlock: (() => void) | undefined;
        const barrier = new Promise<void>((resolve) => {
            unlock = resolve;
        });
        let locked: (() => void) | undefined;
        const acquired = new Promise<void>((resolve) => {
            locked = resolve;
        });
        const blocker = database.connection.transaction(async (transaction) => {
            await transaction
                .select({ id: petInvitations.id })
                .from(petInvitations)
                .where(eq(petInvitations.id, invitation.id.value))
                .for('update');
            locked?.();
            await barrier;
        });

        await acquired;
        const first = useCase.execute(invitation.id.value, recipientId);
        const second = useCase.execute(invitation.id.value, recipientId);

        try {
            let waiting = 0;

            for (let attempt = 0; attempt < 200 && waiting < 2; attempt += 1) {
                const rows = await database.connection.execute(
                    sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%pet_invitations%'`,
                );

                waiting = Number(rows[0]?.waiting ?? 0);

                if (waiting < 2) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 10));
                }
            }

            expect(waiting).toBeGreaterThanOrEqual(2);
        } finally {
            unlock?.();
            await blocker;
        }

        const results = await Promise.all([first, second]);

        expect(results[0]).toEqual(results[1]);
        expect(await recipientMemberships()).toHaveLength(1);
        const saved = await database.connection
            .select({ status: petInvitations.status })
            .from(petInvitations)
            .where(eq(petInvitations.id, invitation.id.value));

        expect(saved).toEqual([{ status: 'ACCEPTED' }]);
    });
});
