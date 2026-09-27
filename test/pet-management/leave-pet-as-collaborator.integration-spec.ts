import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { AcceptInvitation } from '../../src/pet-management/application/accept-invitation/accept-invitation';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import {
  LeavePetAsCollaborator,
  OwnerLeaveNotSupportedError,
} from '../../src/pet-management/application/leave-pet-as-collaborator/leave-pet-as-collaborator';
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

describe('LeavePetAsCollaborator with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let leave: LeavePetAsCollaborator;
  let accept: AcceptInvitation;
  let invitationRepository: DrizzlePetInvitationRepository;
  let pet: Pet;
  let ownerId: string;
  let collaboratorId: string;
  let collaboratorEmail: string;
  let membershipId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CLOCK)
      .useValue({ now: (): Date => NOW })
      .compile();
    application = moduleFixture;
    database = application.get(DatabaseService);
    leave = application.get(LeavePetAsCollaborator);
    accept = application.get(AcceptInvitation);
    invitationRepository = application.get(DrizzlePetInvitationRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    ownerId = randomUUID();
    collaboratorId = randomUUID();
    collaboratorEmail = `leave-${randomUUID()}@example.com`;
    membershipId = randomUUID();
    await database.connection.insert(accounts).values({
      id: collaboratorId,
      email: collaboratorEmail,
      passwordHash: '$argon2id$test-hash',
    });
    pet = Pet.register({
      name: 'Leave pet',
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
    await database.connection
      .delete(accounts)
      .where(eq(accounts.id, collaboratorId));
  });

  async function addMembership(
    status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  ): Promise<void> {
    await database.connection.insert(petMemberships).values({
      id: membershipId,
      petId: pet.id.value,
      accountId: collaboratorId,
      role: 'COLLABORATOR',
      status,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    });
  }

  async function rows() {
    return database.connection
      .select()
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, pet.id.value),
          eq(petMemberships.accountId, collaboratorId),
        ),
      );
  }

  async function createInvitation(): Promise<PetInvitation> {
    const invitation = PetInvitation.create({
      petId: pet.id,
      invitedEmail: InvitedEmail.from(collaboratorEmail),
      invitedByAccountId: AccountId.from(ownerId),
      createdAt: new Date(NOW.getTime() - 86_400_000),
    });
    await invitationRepository.createPending(invitation, null);
    return invitation;
  }

  async function waitForMembershipWaiters(expected: number): Promise<void> {
    let waiting = 0;
    for (let attempt = 0; attempt < 200 && waiting < expected; attempt += 1) {
      const results = await database.connection.execute(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%pet_memberships%'`,
      );
      waiting = Number(results[0]?.waiting ?? 0);
      if (waiting < expected) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(waiting).toBeGreaterThanOrEqual(expected);
  }

  it('preserves identity and role, updates the timestamp once, and retries without an UPDATE', async () => {
    await addMembership();
    const first = await leave.execute(pet.id.value, collaboratorId);
    const afterLeave = await rows();
    expect(first).toEqual({
      petId: pet.id.value,
      membershipId,
      role: 'COLLABORATOR',
      status: 'INACTIVE',
    });
    expect(afterLeave).toHaveLength(1);
    expect(afterLeave[0]).toMatchObject({
      id: membershipId,
      accountId: collaboratorId,
      role: 'COLLABORATOR',
      status: 'INACTIVE',
    });
    expect(afterLeave[0].updatedAt.getTime()).toBeGreaterThan(
      Date.parse('2020-01-01T00:00:00.000Z'),
    );
    await database.connection.execute(
      sql`ALTER TABLE pet_memberships ADD CONSTRAINT test_leave_retry_no_update CHECK (status <> 'INACTIVE') NOT VALID`,
    );
    try {
      expect(await leave.execute(pet.id.value, collaboratorId)).toEqual(first);
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pet_memberships DROP CONSTRAINT test_leave_retry_no_update`,
      );
    }
    expect(await rows()).toEqual(afterLeave);
  });

  it('allows leaving an archived pet', async () => {
    await addMembership();
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, pet.id.value));
    await expect(
      leave.execute(pet.id.value, collaboratorId),
    ).resolves.toMatchObject({ status: 'INACTIVE' });
    expect((await rows())[0].status).toBe('INACTIVE');
  });

  it('hides a nonexistent pet and an absent membership with the same error', async () => {
    await expect(leave.execute(randomUUID(), collaboratorId)).rejects.toThrow(
      PetNotFoundError,
    );
    await expect(leave.execute(pet.id.value, collaboratorId)).rejects.toThrow(
      PetNotFoundError,
    );
  });

  it.each(['ACTIVE', 'INACTIVE'] as const)(
    'never changes an %s owner',
    async (status) => {
      await database.connection
        .update(petMemberships)
        .set({ status })
        .where(
          and(
            eq(petMemberships.petId, pet.id.value),
            eq(petMemberships.accountId, ownerId),
          ),
        );
      const before = await database.connection
        .select()
        .from(petMemberships)
        .where(
          and(
            eq(petMemberships.petId, pet.id.value),
            eq(petMemberships.accountId, ownerId),
          ),
        );
      await expect(leave.execute(pet.id.value, ownerId)).rejects.toThrow(
        OwnerLeaveNotSupportedError,
      );
      const after = await database.connection
        .select()
        .from(petMemberships)
        .where(
          and(
            eq(petMemberships.petId, pet.id.value),
            eq(petMemberships.accountId, ownerId),
          ),
        );
      expect(after).toEqual(before);
    },
  );

  it('serializes two Leaves and returns identical results', async () => {
    await addMembership();
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
        .select({ id: petMemberships.id })
        .from(petMemberships)
        .where(eq(petMemberships.id, membershipId))
        .for('update');
      locked?.();
      await barrier;
    });
    await acquired;
    const first = leave.execute(pet.id.value, collaboratorId);
    let second: Promise<unknown> | undefined;
    try {
      await waitForMembershipWaiters(1);
      second = leave.execute(pet.id.value, collaboratorId);
      await waitForMembershipWaiters(2);
    } finally {
      unlock?.();
      await blocker;
    }
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      id: membershipId,
      status: 'INACTIVE',
    });
  });

  it.each([
    ['leave', 'accept', 'ACTIVE', 'ACTIVE'],
    ['accept', 'leave', 'INACTIVE', 'INACTIVE'],
  ] as const)(
    'serializes %s before %s without deadlock',
    async (firstAction, secondAction, initialStatus, finalStatus) => {
      await addMembership(initialStatus);
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
          .select({ id: petMemberships.id })
          .from(petMemberships)
          .where(eq(petMemberships.id, membershipId))
          .for('update');
        locked?.();
        await barrier;
      });
      await acquired;
      const act = (action: 'leave' | 'accept'): Promise<unknown> =>
        action === 'leave'
          ? leave.execute(pet.id.value, collaboratorId)
          : accept.execute(invitation.id.value, collaboratorId);
      const first = act(firstAction);
      let second: Promise<unknown> | undefined;
      try {
        await waitForMembershipWaiters(1);
        second = act(secondAction);
        await waitForMembershipWaiters(2);
      } finally {
        unlock?.();
        await blocker;
      }
      await expect(first).resolves.toBeDefined();
      await expect(second).resolves.toBeDefined();
      expect(await rows()).toHaveLength(1);
      expect((await rows())[0]).toMatchObject({
        id: membershipId,
        status: finalStatus,
      });
      const invitationRows = await database.connection
        .select({ status: petInvitations.status })
        .from(petInvitations)
        .where(eq(petInvitations.id, invitation.id.value));
      expect(invitationRows[0].status).toBe('ACCEPTED');
    },
  );
});
