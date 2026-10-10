import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { CreatePendingInvitationOutcome } from '../../src/pet-management/application/persistence/pet-invitation.repository';
import { BirthInformation } from '../../src/pet-management/domain/birth-information/birth-information';
import { Breed } from '../../src/pet-management/domain/breed/breed';
import { AccountId } from '../../src/pet-management/domain/pet-membership/pet-membership';
import {
    InvitedEmail,
    PetInvitation,
    PetInvitationStatus,
} from '../../src/pet-management/domain/pet-invitation/pet-invitation';
import { Pet } from '../../src/pet-management/domain/pet/pet';
import { DrizzlePetInvitationRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet-invitation.repository';
import { DrizzlePetRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet.repository';
import {
    petInvitations,
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

const OWNER_ID: string = '550e8400-e29b-41d4-a716-446655440000';
const NOW: Date = new Date('2026-09-26T12:30:00.000Z');

describe('DrizzlePetInvitationRepository (integration)', () => {
    let application: INestApplicationContext;
    let databaseService: DatabaseService;
    let repository: DrizzlePetInvitationRepository;
    let pet: Pet;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = moduleFixture;
        databaseService = application.get(DatabaseService);
        repository = application.get(DrizzlePetInvitationRepository);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        pet = Pet.register({
            name: 'Invitation pet',
            species: 'DOG',
            breed: Breed.custom('Mixed'),
            sex: 'UNKNOWN',
            birthInformation: BirthInformation.approximate('2020-01-01'),
            ownerAccountId: OWNER_ID,
        });
        await new DrizzlePetRepository(databaseService).save(pet);
    });

    afterEach(async () => {
        await databaseService.connection
            .delete(petInvitations)
            .where(eq(petInvitations.petId, pet.id.value));
        await databaseService.connection
            .delete(petMemberships)
            .where(eq(petMemberships.petId, pet.id.value));
        await databaseService.connection.delete(pets).where(eq(pets.id, pet.id.value));
    });

    function createInvitation(
        email: string = '  Ana@Example.COM  ',
        createdAt: Date = NOW,
    ): PetInvitation {
        return PetInvitation.create({
            petId: pet.id,
            invitedEmail: InvitedEmail.from(email),
            invitedByAccountId: AccountId.from(OWNER_ID),
            createdAt,
        });
    }

    function row(
        overrides: Partial<typeof petInvitations.$inferInsert> = {},
    ): typeof petInvitations.$inferInsert {
        return {
            id: randomUUID(),
            petId: pet.id.value,
            invitedEmail: 'ana@example.com',
            invitedByAccountId: OWNER_ID,
            status: PetInvitationStatus.PENDING,
            createdAt: NOW,
            expiresAt: new Date(NOW.getTime() + 604_800_000),
            ...overrides,
        };
    }

    it('persists and loads a normalized pending invitation with exact timestamps', async () => {
        const invitation: PetInvitation = createInvitation();

        await expect(repository.createPending(invitation, null)).resolves.toBe(
            CreatePendingInvitationOutcome.CREATED,
        );
        const saved = await databaseService.connection
            .select()
            .from(petInvitations)
            .where(eq(petInvitations.id, invitation.id.value));

        expect(saved).toEqual([
            {
                id: invitation.id.value,
                petId: pet.id.value,
                invitedEmail: 'ana@example.com',
                invitedByAccountId: OWNER_ID,
                status: 'PENDING',
                createdAt: NOW,
                expiresAt: new Date('2026-10-03T12:30:00.000Z'),
            },
        ]);
        const loaded: PetInvitation | null = await repository.findPending(
            pet.id.value,
            'ana@example.com',
        );

        expect(loaded?.id.value).toBe(invitation.id.value);
    });

    it('allows historical invitations but maps only the pending index collision', async () => {
        await databaseService.connection
            .insert(petInvitations)
            .values(
                [
                    PetInvitationStatus.ACCEPTED,
                    PetInvitationStatus.REJECTED,
                    PetInvitationStatus.CANCELLED,
                    PetInvitationStatus.EXPIRED,
                ].map((status) => row({ status })),
            );
        const invitation: PetInvitation = createInvitation();

        await expect(repository.createPending(invitation, null)).resolves.toBe(
            CreatePendingInvitationOutcome.CREATED,
        );

        await expect(
            databaseService.connection.insert(petInvitations).values(row()),
        ).rejects.toMatchObject({
            cause: {
                code: '23505',
                table_name: 'pet_invitations',
                constraint_name: 'pet_invitations_one_pending_per_email',
            },
        });
        await expect(repository.createPending(createInvitation(), null)).resolves.toBe(
            CreatePendingInvitationOutcome.ALREADY_PENDING,
        );

        const saved = await databaseService.connection
            .select({ status: petInvitations.status })
            .from(petInvitations)
            .where(eq(petInvitations.petId, pet.id.value));

        expect(saved).toHaveLength(5);
    });

    it('lets PostgreSQL resolve simultaneous pending inserts', async () => {
        const outcomes: CreatePendingInvitationOutcome[] = await Promise.all([
            repository.createPending(createInvitation(), null),
            repository.createPending(createInvitation(), null),
        ]);

        expect(outcomes.sort()).toEqual([
            CreatePendingInvitationOutcome.ALREADY_PENDING,
            CreatePendingInvitationOutcome.CREATED,
        ]);
    });

    it('expires an old pending invitation and inserts its replacement atomically', async () => {
        const previous: PetInvitation = createInvitation(
            'ana@example.com',
            new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
        );

        await repository.createPending(previous, null);
        const loaded: PetInvitation | null = await repository.findPending(
            pet.id.value,
            'ana@example.com',
        );

        expect(loaded?.expireIfDue(NOW)).toBe(true);
        const replacement: PetInvitation = createInvitation();

        await expect(repository.createPending(replacement, loaded)).resolves.toBe(
            CreatePendingInvitationOutcome.CREATED,
        );

        const saved = await databaseService.connection
            .select({ id: petInvitations.id, status: petInvitations.status })
            .from(petInvitations)
            .where(eq(petInvitations.petId, pet.id.value));

        expect(saved).toEqual(
            expect.arrayContaining([
                { id: previous.id.value, status: 'EXPIRED' },
                { id: replacement.id.value, status: 'PENDING' },
            ]),
        );
        expect(saved).toHaveLength(2);
    });

    it('rolls back expiration and propagates a primary-key 23505', async () => {
        const previous: PetInvitation = createInvitation(
            'ana@example.com',
            new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
        );

        await repository.createPending(previous, null);
        const loaded: PetInvitation | null = await repository.findPending(
            pet.id.value,
            'ana@example.com',
        );

        expect(loaded?.expireIfDue(NOW)).toBe(true);
        const replacement: PetInvitation = createInvitation();

        await databaseService.connection.insert(petInvitations).values(
            row({
                id: replacement.id.value,
                invitedEmail: 'other@example.com',
                status: PetInvitationStatus.EXPIRED,
            }),
        );

        await expect(repository.createPending(replacement, loaded)).rejects.toMatchObject({
            cause: {
                code: '23505',
                constraint_name: 'pet_invitations_pkey',
            },
        });

        const saved = await databaseService.connection
            .select({ status: petInvitations.status })
            .from(petInvitations)
            .where(eq(petInvitations.id, previous.id.value));

        expect(saved).toEqual([{ status: 'PENDING' }]);
    });

    it('enforces the status, email, timestamp, and pet constraints', async () => {
        await expect(
            databaseService.connection.insert(petInvitations).values(row({ status: 'UNKNOWN' })),
        ).rejects.toMatchObject({
            cause: { constraint_name: 'pet_invitations_status_supported' },
        });
        await expect(
            databaseService.connection
                .insert(petInvitations)
                .values(row({ invitedEmail: 'Ana@Example.COM' })),
        ).rejects.toMatchObject({
            cause: { constraint_name: 'pet_invitations_email_normalized' },
        });
        await expect(
            databaseService.connection.insert(petInvitations).values(row({ expiresAt: NOW })),
        ).rejects.toMatchObject({
            cause: { constraint_name: 'pet_invitations_expires_after_created' },
        });
        await expect(
            databaseService.connection.insert(petInvitations).values(row({ petId: randomUUID() })),
        ).rejects.toMatchObject({
            cause: {
                code: '23503',
                constraint_name: 'pet_invitations_pet_id_pets_id_fk',
            },
        });
    });
});
