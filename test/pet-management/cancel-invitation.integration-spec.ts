import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
  AcceptInvitation,
  InvitationNotPendingError,
} from '../../src/pet-management/application/accept-invitation/accept-invitation';
import {
  CancelInvitation,
  CancelInvitationExpiredError,
  CancelInvitationNotPendingError,
  CancelInvitationNotFoundError,
} from '../../src/pet-management/application/cancel-invitation/cancel-invitation';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import {
  RejectInvitation,
  RejectInvitationNotPendingError,
} from '../../src/pet-management/application/reject-invitation/reject-invitation';
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
const ROLLBACK_ID = 'bb410909-bc4d-4cc7-bd83-9560e22888e8';

describe('CancelInvitation with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let cancel: CancelInvitation;
  let accept: AcceptInvitation;
  let reject: RejectInvitation;
  let repository: DrizzlePetInvitationRepository;
  let pet: Pet;
  let ownerId: string;
  let otherOwnerId: string;
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
    cancel = application.get(CancelInvitation);
    accept = application.get(AcceptInvitation);
    reject = application.get(RejectInvitation);
    repository = application.get(DrizzlePetInvitationRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    ownerId = randomUUID();
    otherOwnerId = randomUUID();
    recipientId = randomUUID();
    recipientEmail = `cancel-${randomUUID()}@example.com`;
    await database.connection.insert(accounts).values({
      id: recipientId,
      email: recipientEmail,
      passwordHash: '$argon2id$test-hash',
    });
    pet = Pet.register({
      name: 'Cancellation pet',
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
      .where(eq(accounts.id, recipientId));
  });

  async function invitation(
    createdAt = new Date(NOW.getTime() - 86_400_000),
  ): Promise<PetInvitation> {
    const value = PetInvitation.create({
      petId: pet.id,
      invitedEmail: InvitedEmail.from(recipientEmail),
      invitedByAccountId: AccountId.from(ownerId),
      createdAt,
    });
    await repository.createPending(value, null);
    return value;
  }

  async function statusOf(invitationId: string): Promise<string> {
    const rows = await database.connection
      .select({ status: petInvitations.status })
      .from(petInvitations)
      .where(eq(petInvitations.id, invitationId));
    return rows[0].status;
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

  async function waitForLockWaiters(expected: number): Promise<void> {
    let waiting = 0;
    for (let attempt = 0; attempt < 200 && waiting < expected; attempt += 1) {
      const rows = await database.connection.execute(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%pet_invitations%'`,
      );
      waiting = Number(rows[0]?.waiting ?? 0);
      if (waiting < expected) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    expect(waiting).toBeGreaterThanOrEqual(expected);
  }

  it('persists cancellation, supports an authorized retry, and leaves recipient membership intact', async () => {
    const value = await invitation();
    await database.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId: pet.id.value,
      accountId: recipientId,
      role: 'COLLABORATOR',
      status: 'INACTIVE',
    });
    const beforeMembership = await recipientMemberships();
    const first = await cancel.execute(value.id.value, ownerId);
    const beforeRetry = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.id, value.id.value));
    await database.connection.execute(
      sql`ALTER TABLE pet_invitations ADD CONSTRAINT test_cancel_retry_no_update CHECK (status <> 'CANCELLED') NOT VALID`,
    );
    try {
      expect(await cancel.execute(value.id.value, ownerId)).toEqual(first);
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pet_invitations DROP CONSTRAINT test_cancel_retry_no_update`,
      );
    }
    expect(first).toEqual({
      id: value.id.value,
      petId: pet.id.value,
      status: 'CANCELLED',
    });
    expect(await statusOf(value.id.value)).toBe('CANCELLED');
    expect(
      await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.id, value.id.value)),
    ).toEqual(beforeRetry);
    expect(await recipientMemberships()).toEqual(beforeMembership);
  });

  it('allows another active owner and denies the inviter after their role changes', async () => {
    const value = await invitation();
    await database.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId: pet.id.value,
      accountId: otherOwnerId,
      role: 'OWNER',
      status: 'ACTIVE',
    });
    await database.connection
      .update(petMemberships)
      .set({ role: 'COLLABORATOR' })
      .where(
        and(
          eq(petMemberships.petId, pet.id.value),
          eq(petMemberships.accountId, ownerId),
        ),
      );
    await expect(cancel.execute(value.id.value, ownerId)).rejects.toThrow(
      PetNotFoundError,
    );
    await expect(
      cancel.execute(value.id.value, otherOwnerId),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(cancel.execute(value.id.value, ownerId)).rejects.toThrow(
      PetNotFoundError,
    );
  });

  it('hides invitation status from collaborators, inactive owners, and nonmembers', async () => {
    const value = await invitation();
    await database.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId: pet.id.value,
      accountId: otherOwnerId,
      role: 'COLLABORATOR',
      status: 'ACTIVE',
    });
    await expect(cancel.execute(value.id.value, otherOwnerId)).rejects.toThrow(
      PetNotFoundError,
    );
    await database.connection
      .update(petMemberships)
      .set({ role: 'OWNER', status: 'INACTIVE' })
      .where(
        and(
          eq(petMemberships.petId, pet.id.value),
          eq(petMemberships.accountId, otherOwnerId),
        ),
      );
    await expect(cancel.execute(value.id.value, otherOwnerId)).rejects.toThrow(
      PetNotFoundError,
    );
    await expect(cancel.execute(value.id.value, randomUUID())).rejects.toThrow(
      PetNotFoundError,
    );
    expect(await statusOf(value.id.value)).toBe('PENDING');
  });

  it('returns invitation missing before pet authorization and hides archived pets on retries', async () => {
    await expect(cancel.execute(randomUUID(), randomUUID())).rejects.toThrow(
      CancelInvitationNotFoundError,
    );
    const value = await invitation();
    await cancel.execute(value.id.value, ownerId);
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, pet.id.value));
    await expect(cancel.execute(value.id.value, ownerId)).rejects.toThrow(
      PetNotFoundError,
    );
  });

  it('persists expiry and returns a conflict for accepted and rejected invitations', async () => {
    const expired = await invitation(new Date(NOW.getTime() - 604_800_000));
    await expect(cancel.execute(expired.id.value, ownerId)).rejects.toThrow(
      CancelInvitationExpiredError,
    );
    expect(await statusOf(expired.id.value)).toBe('EXPIRED');
    for (const status of ['ACCEPTED', 'REJECTED'] as const) {
      const value = await invitation();
      await database.connection
        .update(petInvitations)
        .set({ status })
        .where(eq(petInvitations.id, value.id.value));
      await expect(cancel.execute(value.id.value, ownerId)).rejects.toThrow(
        CancelInvitationNotPendingError,
      );
    }
  });

  it('rolls back a failed invitation transition', async () => {
    await database.connection.insert(petInvitations).values({
      id: ROLLBACK_ID,
      petId: pet.id.value,
      invitedEmail: recipientEmail,
      invitedByAccountId: ownerId,
      status: 'PENDING',
      createdAt: new Date(NOW.getTime() - 86_400_000),
      expiresAt: new Date(NOW.getTime() + 518_400_000),
    });
    await database.connection.execute(
      sql`ALTER TABLE pet_invitations ADD CONSTRAINT test_cancel_rollback CHECK (id <> 'bb410909-bc4d-4cc7-bd83-9560e22888e8'::uuid OR status <> 'CANCELLED')`,
    );
    try {
      await expect(cancel.execute(ROLLBACK_ID, ownerId)).rejects.toThrow();
      expect(await statusOf(ROLLBACK_ID)).toBe('PENDING');
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pet_invitations DROP CONSTRAINT test_cancel_rollback`,
      );
    }
  });

  it.each(['archive pet', 'remove owner role'] as const)(
    'observes a concurrent %s that commits before authorization',
    async (change) => {
      const value = await invitation();
      let unlock: (() => void) | undefined;
      const barrier = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      let changed: (() => void) | undefined;
      const changeReady = new Promise<void>((resolve) => {
        changed = resolve;
      });
      const blocker = database.connection.transaction(async (transaction) => {
        if (change === 'archive pet') {
          await transaction
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, pet.id.value));
        } else {
          await transaction
            .update(petMemberships)
            .set({ role: 'COLLABORATOR' })
            .where(
              and(
                eq(petMemberships.petId, pet.id.value),
                eq(petMemberships.accountId, ownerId),
              ),
            );
        }
        changed?.();
        await barrier;
      });
      await changeReady;
      const cancellation = cancel.execute(value.id.value, ownerId);
      try {
        let waiting = 0;
        for (let attempt = 0; attempt < 200 && waiting === 0; attempt += 1) {
          const rows = await database.connection.execute(
            sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%pet_%'`,
          );
          waiting = Number(rows[0]?.waiting ?? 0);
          if (waiting === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
          }
        }
        expect(waiting).toBeGreaterThan(0);
      } finally {
        unlock?.();
        await blocker;
      }
      await expect(cancellation).rejects.toThrow(PetNotFoundError);
      expect(await statusOf(value.id.value)).toBe('PENDING');
    },
  );

  it.each([
    ['cancel', 'cancel', 'CANCELLED'],
    ['accept', 'cancel', 'ACCEPTED'],
    ['cancel', 'accept', 'CANCELLED'],
    ['reject', 'cancel', 'REJECTED'],
    ['cancel', 'reject', 'CANCELLED'],
  ] as const)(
    'serializes %s before %s on the invitation row',
    async (firstAction, secondAction, finalStatus) => {
      const value = await invitation();
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
          .where(eq(petInvitations.id, value.id.value))
          .for('update');
        locked?.();
        await barrier;
      });
      await acquired;
      const act = (
        action: 'accept' | 'reject' | 'cancel',
      ): Promise<unknown> => {
        if (action === 'accept')
          return accept.execute(value.id.value, recipientId);
        if (action === 'reject')
          return reject.execute(value.id.value, recipientId);
        return cancel.execute(value.id.value, ownerId);
      };
      const first = act(firstAction);
      let second: Promise<unknown> | undefined;
      try {
        await waitForLockWaiters(1);
        second = act(secondAction);
        await waitForLockWaiters(2);
      } finally {
        unlock?.();
        await blocker;
      }
      if (firstAction === 'cancel' && secondAction === 'cancel') {
        const results = await Promise.all([first, second]);
        expect(results[0]).toEqual(results[1]);
      } else {
        await expect(first).resolves.toMatchObject({ status: finalStatus });
        await expect(second).rejects.toThrow(
          secondAction === 'accept'
            ? InvitationNotPendingError
            : secondAction === 'reject'
              ? RejectInvitationNotPendingError
              : CancelInvitationNotPendingError,
        );
      }
      expect(await statusOf(value.id.value)).toBe(finalStatus);
    },
  );
});
