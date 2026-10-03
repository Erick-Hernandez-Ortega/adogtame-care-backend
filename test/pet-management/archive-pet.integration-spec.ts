import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { ArchivePet } from '../../src/pet-management/application/archive-pet/archive-pet';
import { InviteCollaborator } from '../../src/pet-management/application/invite-collaborator/invite-collaborator';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import {
  ACCOUNT_LOOKUP,
  type AccountLookup,
} from '../../src/pet-management/application/identity/account-lookup';
import { PetInvitation } from '../../src/pet-management/domain/pet-invitation/pet-invitation';
import { CLOCK } from '../../src/pet-management/application/time/clock';
import { BirthInformation } from '../../src/pet-management/domain/birth-information/birth-information';
import { Breed } from '../../src/pet-management/domain/breed/breed';
import { AccountId } from '../../src/pet-management/domain/pet-membership/pet-membership';
import { InvitedEmail } from '../../src/pet-management/domain/pet-invitation/pet-invitation';
import { Pet } from '../../src/pet-management/domain/pet/pet';
import { DrizzlePetRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet.repository';
import { DrizzlePetQueryRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet-query.repository';
import { DrizzlePetInvitationRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet-invitation.repository';
import {
  petInvitations,
  petMemberships,
  pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import {
  healthWeightRecords,
  healthVaccinationRecords,
} from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { RecordPetWeight } from '../../src/health/application/record-pet-weight/record-pet-weight';

const NOW: Date = new Date('2026-10-03T12:00:00.000Z');
const ORIGINAL_TIMESTAMP: Date = new Date('2020-01-01T00:00:00.000Z');
type Action =
  | 'archive'
  | 'profile'
  | 'promote'
  | 'remove'
  | 'invite'
  | 'accept'
  | 'leave'
  | 'weight';

interface Barrier {
  promise: Promise<void>;
  release: () => void;
}
function barrier(): Barrier {
  let release: () => void = (): void => {
    throw new Error('Barrier not initialized');
  };
  const promise: Promise<void> = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface SettledAction {
  value?: unknown;
  error?: unknown;
}
async function settle(action: Promise<unknown>): Promise<SettledAction> {
  try {
    return { value: await action };
  } catch (error: unknown) {
    return { error };
  }
}

describe('Archive Pet with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let repository: DrizzlePetRepository;
  let queries: DrizzlePetQueryRepository;
  let invitations: DrizzlePetInvitationRepository;
  let archive: ArchivePet;
  let pet: Pet;
  let ownerId: string;
  let otherOwnerId: string;
  let collaboratorId: string;
  let recipientId: string;
  let accountIds: string[];
  let targetMembershipId: string;
  let pending: PetInvitation;
  let expired: PetInvitation | null;
  let blockerBackendId: number;

  beforeAll(async () => {
    application = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue({ now: (): Date => NOW })
      .compile();
    database = application.get(DatabaseService);
    repository = application.get(DrizzlePetRepository);
    queries = application.get(DrizzlePetQueryRepository);
    invitations = application.get(DrizzlePetInvitationRepository);
    archive = application.get(ArchivePet);
  });
  afterAll(async () => {
    await application.close();
  });
  beforeEach(async () => {
    accountIds = [];
    for (const label of ['owner', 'other-owner', 'collaborator', 'recipient']) {
      const id: string = randomUUID();
      await database.connection.insert(accounts).values({
        id,
        email: `${label}-${id}@example.com`,
        passwordHash: '$argon2id$test-hash',
      });
      accountIds.push(id);
    }
    [ownerId, otherOwnerId, collaboratorId, recipientId] = accountIds;
    pet = Pet.register({
      name: 'Archive pet',
      species: 'DOG',
      breed: Breed.custom('Mixed'),
      sex: 'UNKNOWN',
      birthInformation: BirthInformation.approximate('2020-01-01'),
      ownerAccountId: ownerId,
      color: 'Brown',
      distinctiveMarks: 'White paw',
      microchip: 'chip',
    });
    await repository.save(pet);
    targetMembershipId = randomUUID();
    await database.connection.insert(petMemberships).values([
      {
        id: randomUUID(),
        petId: pet.id.value,
        accountId: otherOwnerId,
        role: 'OWNER',
        status: 'ACTIVE',
        createdAt: ORIGINAL_TIMESTAMP,
        updatedAt: ORIGINAL_TIMESTAMP,
      },
      {
        id: targetMembershipId,
        petId: pet.id.value,
        accountId: collaboratorId,
        role: 'COLLABORATOR',
        status: 'ACTIVE',
        createdAt: ORIGINAL_TIMESTAMP,
        updatedAt: ORIGINAL_TIMESTAMP,
      },
    ]);
    pending = invitation(NOW);
    await invitations.createPending(pending, null);
    expired = null;
  });
  afterEach(async () => {
    await database.connection
      .delete(healthWeightRecords)
      .where(eq(healthWeightRecords.petId, pet.id.value));
    await database.connection
      .delete(healthVaccinationRecords)
      .where(eq(healthVaccinationRecords.petId, pet.id.value));
    await database.connection
      .delete(petInvitations)
      .where(eq(petInvitations.petId, pet.id.value));
    await database.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, pet.id.value));
    await database.connection.delete(pets).where(eq(pets.id, pet.id.value));
    await database.connection
      .delete(accounts)
      .where(inArray(accounts.id, accountIds));
  });

  function invitation(createdAt: Date): PetInvitation {
    return PetInvitation.create({
      petId: pet.id,
      invitedEmail: InvitedEmail.from(`recipient-${recipientId}@example.com`),
      invitedByAccountId: AccountId.from(ownerId),
      createdAt,
    });
  }
  async function petRow() {
    return (
      await database.connection
        .select()
        .from(pets)
        .where(eq(pets.id, pet.id.value))
    )[0];
  }
  async function memberships() {
    return database.connection
      .select()
      .from(petMemberships)
      .where(eq(petMemberships.petId, pet.id.value))
      .orderBy(petMemberships.id);
  }
  async function useExpiredInvitation(): Promise<void> {
    await database.connection
      .delete(petInvitations)
      .where(eq(petInvitations.id, pending.id.value));
    pending = invitation(new Date(NOW.getTime() - 8 * 86_400_000));
    await invitations.createPending(pending, null);
    expired = await invitations.findPending(
      pet.id.value,
      pending.invitedEmail.value,
    );
    if (expired === null || !expired.expireIfDue(NOW))
      throw new Error('Expected an expired invitation');
  }
  function act(action: Action): Promise<unknown> {
    const command = {
      petId: pet.id.value,
      requesterAccountId: ownerId,
      targetMembershipId,
    };
    switch (action) {
      case 'archive':
        return repository.archiveIfOwned(command);
      case 'profile':
        return repository.correctProfileIfOwned(
          pet.id.value,
          ownerId,
          (currentPet: Pet): Pet =>
            currentPet.correctProfile({ name: 'Updated profile' }),
        );
      case 'promote':
        return repository.promoteCollaboratorIfOwned(command);
      case 'remove':
        return repository.removeMemberIfOwned(command);
      case 'invite':
        return invitations.createPending(invitation(NOW), expired);
      case 'accept':
        return invitations.accept(
          pending.id.value,
          pending.invitedEmail.value,
          recipientId,
        );
      case 'leave':
        return repository.leave(pet.id.value, ownerId);
      case 'weight':
        return application.get(RecordPetWeight).execute({
          petId: pet.id.value,
          authenticatedAccountId: ownerId,
          weightKg: '12.5',
          measuredDate: '2026-09-01',
        });
    }
  }

  async function blockRow(
    table: 'pets' | 'pet_invitations',
    id: string,
  ): Promise<() => Promise<void>> {
    const acquired: Barrier = barrier();
    const released: Barrier = barrier();
    const blocker: Promise<void> = database.connection.transaction(
      async (transaction) => {
        const backendRows = await transaction.execute(
          sql`SELECT pg_backend_pid() AS id`,
        );
        blockerBackendId = Number(backendRows[0].id);
        await transaction.execute(sql`SET LOCAL statement_timeout = '8000ms'`);
        if (table === 'pets')
          await transaction
            .select()
            .from(pets)
            .where(eq(pets.id, id))
            .for('update');
        else
          await transaction
            .select()
            .from(petInvitations)
            .where(eq(petInvitations.id, id))
            .for('update');
        acquired.release();
        await released.promise;
      },
    );
    await acquired.promise;
    return async (): Promise<void> => {
      released.release();
      await blocker;
    };
  }
  async function waitForLock(expected: number): Promise<void> {
    const deadline: number = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await database.connection.execute(sql`
        WITH RECURSIVE blocked AS (
          SELECT pid FROM pg_stat_activity WHERE ${blockerBackendId} = ANY(pg_blocking_pids(pid))
          UNION
          SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
        ) SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE pid IN (SELECT pid FROM blocked) AND wait_event_type = 'Lock'
      `);
      if (Number(rows[0]?.waiting ?? 0) >= expected) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Expected ${expected} blocked operations`);
  }
  async function race(
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
    table: 'pets' | 'pet_invitations' = 'pets',
  ): Promise<[SettledAction, SettledAction]> {
    const release = await blockRow(
      table,
      table === 'pets' ? pet.id.value : pending.id.value,
    );
    const firstResult: Promise<SettledAction> = settle(first());
    let secondResult: Promise<SettledAction> | undefined;
    try {
      await waitForLock(1);
      secondResult = settle(second());
      await waitForLock(2);
    } finally {
      await release();
    }
    if (secondResult === undefined)
      throw new Error('Second operation did not start');
    return Promise.all([firstResult, secondResult]);
  }

  async function withoutRedundantUpdates(
    action: () => Promise<void>,
  ): Promise<void> {
    await database.connection.execute(
      sql`CREATE FUNCTION test_archive_reject_redundant_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Redundant archived pet UPDATE'; END; $$ LANGUAGE plpgsql`,
    );
    try {
      await database.connection.execute(
        sql.raw(
          `CREATE TRIGGER test_archive_no_redundant_update BEFORE UPDATE ON pets FOR EACH ROW WHEN (OLD.id = '${pet.id.value}'::uuid AND OLD.status = 'ARCHIVED') EXECUTE FUNCTION test_archive_reject_redundant_update()`,
        ),
      );
      try {
        await action();
      } finally {
        await database.connection.execute(
          sql`DROP TRIGGER test_archive_no_redundant_update ON pets`,
        );
      }
    } finally {
      await database.connection.execute(
        sql`DROP FUNCTION test_archive_reject_redundant_update()`,
      );
    }
  }

  it('archives only lifecycle and preserves memberships, profile, invitation and timestamps on retry', async () => {
    const before = await petRow();
    const membersBefore = await memberships();
    const invitationsBefore = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.petId, pet.id.value));
    await archive.execute({ petId: pet.id.value, requesterAccountId: ownerId });
    const after = await petRow();
    expect(after).toEqual({
      ...before,
      status: 'ARCHIVED',
      updatedAt: expect.any(Date) as Date,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
    expect(after.updatedAt).not.toEqual(before.updatedAt);
    expect(await memberships()).toEqual(membersBefore);
    expect(
      await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.petId, pet.id.value)),
    ).toEqual(invitationsBefore);
    await withoutRedundantUpdates(async () => {
      await archive.execute({
        petId: pet.id.value,
        requesterAccountId: ownerId,
      });
      await archive.execute({
        petId: pet.id.value,
        requesterAccountId: otherOwnerId,
      });
    });
    expect(await petRow()).toEqual(after);
    expect(await queries.findAccessibleByAccountId(collaboratorId)).toEqual([
      expect.objectContaining({ id: pet.id.value, status: 'ARCHIVED' }),
    ]);
    expect(
      await queries.findAccessibleDetailById(pet.id.value, collaboratorId),
    ).toMatchObject({ status: 'ARCHIVED' });
    expect(
      await queries.findAccessibleMembers(pet.id.value, ownerId),
    ).toHaveLength(3);
  });

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'conceals %s pets from collaborators, inactive members and outsiders',
    async (status) => {
      if (status === 'ARCHIVED') await act('archive');
      for (const requesterAccountId of [
        collaboratorId,
        recipientId,
        randomUUID(),
      ])
        await expect(
          archive.execute({ petId: pet.id.value, requesterAccountId }),
        ).rejects.toBeInstanceOf(PetNotFoundError);
      await repository.leave(pet.id.value, ownerId);
      await repository.leave(pet.id.value, collaboratorId);
      for (const requesterAccountId of [ownerId, collaboratorId])
        await expect(
          archive.execute({ petId: pet.id.value, requesterAccountId }),
        ).rejects.toBeInstanceOf(PetNotFoundError);
      await expect(
        archive.execute({
          petId: randomUUID(),
          requesterAccountId: otherOwnerId,
        }),
      ).rejects.toBeInstanceOf(PetNotFoundError);
    },
  );

  it('rolls back a failed archive', async () => {
    await database.connection.execute(
      sql.raw(
        `ALTER TABLE pets ADD CONSTRAINT test_archive_rollback CHECK (id <> '${pet.id.value}'::uuid OR status <> 'ARCHIVED')`,
      ),
    );
    try {
      await expect(act('archive')).rejects.toThrow();
      expect((await petRow()).status).toBe('ACTIVE');
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pets DROP CONSTRAINT test_archive_rollback`,
      );
    }
  });

  it.each([false, true])(
    'serializes concurrent archives with another owner=%s and exactly one physical UPDATE',
    async (isOtherOwner) => {
      await withoutRedundantUpdates(async () => {
        const results = await race(
          () => act('archive'),
          () =>
            repository.archiveIfOwned({
              petId: pet.id.value,
              requesterAccountId: isOtherOwner ? otherOwnerId : ownerId,
            }),
        );
        expect(results).toEqual([
          { value: { outcome: 'ARCHIVED' } },
          { value: { outcome: 'ALREADY_ARCHIVED' } },
        ]);
      });
    },
  );

  const operations: Action[] = [
    'profile',
    'promote',
    'remove',
    'invite',
    'accept',
    'leave',
    'weight',
  ];
  it.each(operations)('serializes Archive before %s', async (action) => {
    if (action === 'invite')
      await database.connection
        .delete(petInvitations)
        .where(eq(petInvitations.id, pending.id.value));
    const before = await memberships();
    const results = await race(
      () => act('archive'),
      () => act(action),
    );
    expect(results[0]).toEqual({ value: { outcome: 'ARCHIVED' } });
    expect((await petRow()).status).toBe('ARCHIVED');
    switch (action) {
      case 'profile':
        expect(results[1]).toEqual({ value: null });
        break;
      case 'promote':
      case 'remove':
        expect(results[1]).toEqual({ value: { outcome: 'PET_NOT_FOUND' } });
        break;
      case 'invite':
        expect(results[1]).toEqual({ value: 'PET_NOT_FOUND' });
        break;
      case 'accept':
        expect(results[1]).toEqual({ value: { outcome: 'NOT_ACCEPTABLE' } });
        break;
      case 'leave':
        expect(results[1]).toEqual({ value: { outcome: 'LEFT' } });
        break;
      case 'weight':
        expect(results[1].error).toBeInstanceOf(Error);
        expect((results[1].error as Error).message).toBe('Pet was not found');
        break;
    }
    if (action !== 'leave') expect(await memberships()).toEqual(before);
    expect(
      await database.connection
        .select()
        .from(healthWeightRecords)
        .where(eq(healthWeightRecords.petId, pet.id.value)),
    ).toEqual([]);
    if (action === 'invite')
      expect(
        await database.connection
          .select()
          .from(petInvitations)
          .where(eq(petInvitations.petId, pet.id.value)),
      ).toEqual([]);
  });
  it.each(operations)('serializes %s before Archive', async (action) => {
    if (action === 'invite')
      await database.connection
        .delete(petInvitations)
        .where(eq(petInvitations.id, pending.id.value));
    const results = await race(
      () => act(action),
      () => act('archive'),
    );
    expect(results[0].error).toBeUndefined();
    if (action === 'leave') {
      expect(results[0].value).toEqual({ outcome: 'LEFT' });
      expect(results[1]).toEqual({ value: { outcome: 'PET_NOT_FOUND' } });
      expect((await petRow()).status).toBe('ACTIVE');
      await archive.execute({
        petId: pet.id.value,
        requesterAccountId: otherOwnerId,
      });
    } else {
      expect(results[1]).toEqual({ value: { outcome: 'ARCHIVED' } });
      if (action === 'profile')
        expect((await petRow()).name).toBe('Updated profile');
      if (action === 'promote')
        expect(
          (await memberships()).find(
            (member) => member.id === targetMembershipId,
          )?.role,
        ).toBe('OWNER');
      if (action === 'remove')
        expect(
          (await memberships()).find(
            (member) => member.id === targetMembershipId,
          )?.status,
        ).toBe('INACTIVE');
      if (action === 'invite') expect(results[0].value).toBe('CREATED');
      if (action === 'accept')
        expect(results[0].value).toMatchObject({ outcome: 'ACCEPTED' });
      if (action === 'weight')
        expect(
          await database.connection
            .select()
            .from(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, pet.id.value)),
        ).toHaveLength(1);
    }
    expect((await petRow()).status).toBe('ARCHIVED');
  });

  it.each([true, false])(
    'serializes expired invitation replacement against Archive, archive first=%s',
    async (isArchiveFirst) => {
      await useExpiredInvitation();
      const results = await race(
        () => act(isArchiveFirst ? 'archive' : 'invite'),
        () => act(isArchiveFirst ? 'invite' : 'archive'),
      );
      if (isArchiveFirst) {
        expect(results).toEqual([
          { value: { outcome: 'ARCHIVED' } },
          { value: 'PET_NOT_FOUND' },
        ]);
        expect(
          await database.connection
            .select()
            .from(petInvitations)
            .where(eq(petInvitations.id, pending.id.value)),
        ).toEqual([expect.objectContaining({ status: 'PENDING' })]);
      } else {
        expect(results).toEqual([
          { value: 'CREATED' },
          { value: { outcome: 'ARCHIVED' } },
        ]);
      }
    },
  );

  it.each([
    ['accept', true],
    ['accept', false],
    ['cancel', true],
    ['cancel', false],
  ] as const)(
    'keeps Invitation first against %s, replacement first=%s',
    async (action, isReplacementFirst) => {
      await useExpiredInvitation();
      const operation = (): Promise<unknown> =>
        action === 'accept'
          ? act('accept')
          : invitations.cancel(pending.id.value, ownerId);
      const replacement = (): Promise<unknown> => act('invite');
      const results = await race(
        isReplacementFirst ? replacement : operation,
        isReplacementFirst ? operation : replacement,
        'pet_invitations',
      );
      const expected: SettledAction[] = [
        { value: 'CREATED' },
        { value: { outcome: 'EXPIRED' } },
      ];
      expect(results).toEqual(
        isReplacementFirst ? expected : expected.reverse(),
      );
      expect(
        await database.connection
          .select()
          .from(petInvitations)
          .where(
            and(
              eq(petInvitations.petId, pet.id.value),
              eq(petInvitations.status, 'PENDING'),
            ),
          ),
      ).toHaveLength(1);
    },
  );

  it('allows another active owner to archive after a concurrent owner leave', async () => {
    const results = await race(
      () => act('leave'),
      () =>
        repository.archiveIfOwned({
          petId: pet.id.value,
          requesterAccountId: otherOwnerId,
        }),
    );
    expect(results).toEqual([
      { value: { outcome: 'LEFT' } },
      { value: { outcome: 'ARCHIVED' } },
    ]);
    expect(await repository.leave(pet.id.value, otherOwnerId)).toEqual({
      outcome: 'LAST_OWNER_CANNOT_LEAVE',
    });
  });

  it.each([false, true])(
    'revalidates inviter membership under lock, expired replacement=%s',
    async (hasExpiredInvitation) => {
      if (hasExpiredInvitation) await useExpiredInvitation();
      else
        await database.connection
          .delete(petInvitations)
          .where(eq(petInvitations.id, pending.id.value));
      await repository.leave(pet.id.value, ownerId);
      expect(await act('invite')).toBe('PET_NOT_FOUND');
      const rows = await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.petId, pet.id.value));
      expect(rows).toEqual(
        hasExpiredInvitation
          ? [expect.objectContaining({ status: 'PENDING' })]
          : [],
      );
    },
  );

  it.each([false, true])(
    'revalidates stale Invite authorization after Archive, expired replacement=%s',
    async (hasExpiredInvitation) => {
      if (hasExpiredInvitation) await useExpiredInvitation();
      else
        await database.connection
          .delete(petInvitations)
          .where(eq(petInvitations.id, pending.id.value));
      const lookup: AccountLookup = application.get(ACCOUNT_LOOKUP);
      const entered: Barrier = barrier();
      const proceed: Barrier = barrier();
      const delayedLookup: AccountLookup = {
        findAccountIdByEmail: async (email: string): Promise<string | null> => {
          entered.release();
          await proceed.promise;
          return lookup.findAccountIdByEmail(email);
        },
        findEmailByAccountId: (id: string): Promise<string | null> =>
          lookup.findEmailByAccountId(id),
        findEmailsByAccountIds: (ids: readonly string[]) =>
          lookup.findEmailsByAccountIds(ids),
      };
      const invite: InviteCollaborator = new InviteCollaborator(
        queries,
        delayedLookup,
        invitations,
        { now: (): Date => NOW },
      );
      const result: Promise<SettledAction> = settle(
        invite.execute({
          petId: pet.id.value,
          invitedByAccountId: ownerId,
          email: pending.invitedEmail.value,
        }),
      );
      await entered.promise;
      try {
        await act('archive');
      } finally {
        proceed.release();
      }
      expect((await result).error).toBeInstanceOf(PetNotFoundError);
      expect(
        await database.connection
          .select()
          .from(petInvitations)
          .where(eq(petInvitations.id, pending.id.value)),
      ).toEqual(
        hasExpiredInvitation
          ? [expect.objectContaining({ status: 'PENDING' })]
          : [],
      );
    },
  );

  it('keeps the last owner active after Archive and permits another owner to leave', async () => {
    await act('archive');
    expect(await repository.leave(pet.id.value, ownerId)).toEqual({
      outcome: 'LEFT',
    });
    expect(await repository.leave(pet.id.value, otherOwnerId)).toEqual({
      outcome: 'LAST_OWNER_CANNOT_LEAVE',
    });
    expect(await act('archive')).toEqual({ outcome: 'PET_NOT_FOUND' });
    expect(
      await repository.archiveIfOwned({
        petId: pet.id.value,
        requesterAccountId: otherOwnerId,
      }),
    ).toEqual({ outcome: 'ALREADY_ARCHIVED' });
  });
});
