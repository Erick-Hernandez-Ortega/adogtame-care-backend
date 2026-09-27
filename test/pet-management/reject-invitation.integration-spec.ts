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
  RejectInvitation,
  RejectInvitationExpiredError,
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
const ROLLBACK_INVITATION_ID = 'bb410909-bc4d-4cc7-bd83-9560e22888e9';

describe('RejectInvitation with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let rejectInvitation: RejectInvitation;
  let acceptInvitation: AcceptInvitation;
  let repository: DrizzlePetInvitationRepository;
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
    rejectInvitation = application.get(RejectInvitation);
    acceptInvitation = application.get(AcceptInvitation);
    repository = application.get(DrizzlePetInvitationRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    ownerId = randomUUID();
    recipientId = randomUUID();
    recipientEmail = `reject-${randomUUID()}@example.com`;
    await database.connection.insert(accounts).values({
      id: recipientId,
      email: recipientEmail,
      passwordHash: '$argon2id$test-hash',
    });
    pet = Pet.register({
      name: 'Rejection pet',
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

  async function createInvitation(
    createdAt: Date = new Date(NOW.getTime() - 86_400_000),
  ): Promise<PetInvitation> {
    const invitation = PetInvitation.create({
      petId: pet.id,
      invitedEmail: InvitedEmail.from(recipientEmail),
      invitedByAccountId: AccountId.from(ownerId),
      createdAt,
    });
    await repository.createPending(invitation, null);
    return invitation;
  }

  async function statusOf(invitationId: string): Promise<string> {
    const rows = await database.connection
      .select({ status: petInvitations.status })
      .from(petInvitations)
      .where(eq(petInvitations.id, invitationId));
    return rows[0].status;
  }

  async function membershipRows() {
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

  it('persists rejection and returns the same result on retry', async () => {
    const invitation = await createInvitation();
    const first = await rejectInvitation.execute(
      invitation.id.value,
      recipientId,
    );
    const saved = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.id, invitation.id.value));
    const second = await rejectInvitation.execute(
      invitation.id.value,
      recipientId,
    );
    const afterRetry = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.id, invitation.id.value));
    expect(first).toEqual({
      id: invitation.id.value,
      petId: pet.id.value,
      status: 'REJECTED',
    });
    expect(second).toEqual(first);
    expect(afterRetry).toEqual(saved);
    expect(await membershipRows()).toEqual([]);
  });

  it('persists expiration without touching membership', async () => {
    const invitation = await createInvitation(
      new Date(NOW.getTime() - 604_800_000),
    );
    await expect(
      rejectInvitation.execute(invitation.id.value, recipientId),
    ).rejects.toThrow(RejectInvitationExpiredError);
    expect(await statusOf(invitation.id.value)).toBe('EXPIRED');
    expect(await membershipRows()).toEqual([]);
  });

  it('rejects an archived pet and leaves an existing membership unchanged', async () => {
    const invitation = await createInvitation();
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, pet.id.value));
    await database.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId: pet.id.value,
      accountId: recipientId,
      role: 'OWNER',
      status: 'INACTIVE',
    });
    const before = await membershipRows();
    await rejectInvitation.execute(invitation.id.value, recipientId);
    expect(await statusOf(invitation.id.value)).toBe('REJECTED');
    expect(await membershipRows()).toEqual(before);
  });

  it('rolls back when the rejection update fails', async () => {
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
      sql`ALTER TABLE pet_invitations ADD CONSTRAINT test_reject_rollback CHECK (id <> 'bb410909-bc4d-4cc7-bd83-9560e22888e9'::uuid OR status <> 'REJECTED')`,
    );
    try {
      await expect(
        rejectInvitation.execute(ROLLBACK_INVITATION_ID, recipientId),
      ).rejects.toThrow();
      expect(await statusOf(ROLLBACK_INVITATION_ID)).toBe('PENDING');
      expect(await membershipRows()).toEqual([]);
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pet_invitations DROP CONSTRAINT test_reject_rollback`,
      );
    }
  });

  it.each([
    ['reject', 'reject', 'REJECTED'],
    ['accept', 'reject', 'ACCEPTED'],
    ['reject', 'accept', 'REJECTED'],
  ] as const)(
    'serializes %s before %s on the invitation row',
    async (firstAction, secondAction, finalStatus) => {
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
      const first =
        firstAction === 'accept'
          ? acceptInvitation.execute(invitation.id.value, recipientId)
          : rejectInvitation.execute(invitation.id.value, recipientId);
      let second: Promise<unknown> | undefined;
      try {
        await waitForLockWaiters(1);
        second =
          secondAction === 'accept'
            ? acceptInvitation.execute(invitation.id.value, recipientId)
            : rejectInvitation.execute(invitation.id.value, recipientId);
        await waitForLockWaiters(2);
      } finally {
        unlock?.();
        await blocker;
      }
      if (firstAction === 'reject' && secondAction === 'reject') {
        const results = await Promise.all([first, second]);
        expect(results[0]).toEqual(results[1]);
      } else {
        await expect(first).resolves.toMatchObject({ status: finalStatus });
        await expect(second).rejects.toThrow(
          secondAction === 'accept'
            ? InvitationNotPendingError
            : RejectInvitationNotPendingError,
        );
      }
      expect(await statusOf(invitation.id.value)).toBe(finalStatus);
      expect(await membershipRows()).toHaveLength(
        finalStatus === 'ACCEPTED' ? 1 : 0,
      );
    },
  );
});
