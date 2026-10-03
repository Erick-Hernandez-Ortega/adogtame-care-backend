import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { ArchivePet } from '../../src/pet-management/application/archive-pet/archive-pet';
import { RestorePet } from '../../src/pet-management/application/restore-pet/restore-pet';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
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
  | 'restore'
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

describe('Restore Pet with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let repository: DrizzlePetRepository;
  let queries: DrizzlePetQueryRepository;
  let invitations: DrizzlePetInvitationRepository;
  let archive: ArchivePet;
  let restore: RestorePet;
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
  let currentTime: Date = NOW;

  beforeAll(async () => {
    application = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue({ now: (): Date => currentTime })
      .compile();
    database = application.get(DatabaseService);
    repository = application.get(DrizzlePetRepository);
    queries = application.get(DrizzlePetQueryRepository);
    invitations = application.get(DrizzlePetInvitationRepository);
    archive = application.get(ArchivePet);
    restore = application.get(RestorePet);
  });
  afterAll(async () => {
    await application.close();
  });
  beforeEach(async () => {
    currentTime = NOW;
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
      case 'restore':
        return repository.restoreIfOwned(command);
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
      sql`CREATE FUNCTION test_restore_reject_redundant_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Redundant active pet UPDATE'; END; $$ LANGUAGE plpgsql`,
    );
    try {
      await database.connection.execute(
        sql.raw(
          `CREATE TRIGGER test_restore_no_redundant_update BEFORE UPDATE ON pets FOR EACH ROW WHEN (OLD.id = '${pet.id.value}'::uuid AND OLD.status = 'ACTIVE') EXECUTE FUNCTION test_restore_reject_redundant_update()`,
        ),
      );
      try {
        await action();
      } finally {
        await database.connection.execute(
          sql`DROP TRIGGER test_restore_no_redundant_update ON pets`,
        );
      }
    } finally {
      await database.connection.execute(
        sql`DROP FUNCTION test_restore_reject_redundant_update()`,
      );
    }
  }

  it('preserves both Health histories and their timestamps through Archive and Restore', async () => {
    await database.connection.insert(healthWeightRecords).values({
      id: randomUUID(),
      petId: pet.id.value,
      weightKg: '12.5',
      measuredDate: '2026-09-01',
      recordedByAccountId: ownerId,
    });
    await database.connection.insert(healthVaccinationRecords).values({
      id: randomUUID(),
      petId: pet.id.value,
      vaccineName: 'Rabies',
      appliedDate: '2026-09-01',
      nextDueDate: '2027-09-01',
      recordedByAccountId: ownerId,
    });
    const weightsBefore = await database.connection
      .select()
      .from(healthWeightRecords)
      .where(eq(healthWeightRecords.petId, pet.id.value));
    const vaccinationsBefore = await database.connection
      .select()
      .from(healthVaccinationRecords)
      .where(eq(healthVaccinationRecords.petId, pet.id.value));
    await act('archive');
    await act('restore');
    await act('restore');
    expect(
      await database.connection
        .select()
        .from(healthWeightRecords)
        .where(eq(healthWeightRecords.petId, pet.id.value)),
    ).toEqual(weightsBefore);
    expect(
      await database.connection
        .select()
        .from(healthVaccinationRecords)
        .where(eq(healthVaccinationRecords.petId, pet.id.value)),
    ).toEqual(vaccinationsBefore);
  });

  it('restores only lifecycle and preserves all profile, membership and invitation state on retries', async () => {
    for (const status of [
      'ACCEPTED',
      'REJECTED',
      'CANCELLED',
      'EXPIRED',
    ] as const) {
      await database.connection.insert(petInvitations).values({
        id: randomUUID(),
        petId: pet.id.value,
        invitedEmail: `${status.toLowerCase()}@example.com`,
        invitedByAccountId: ownerId,
        status,
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 86400000),
      });
    }
    await archive.execute({ petId: pet.id.value, requesterAccountId: ownerId });
    await repository.leave(pet.id.value, otherOwnerId);
    await repository.leave(pet.id.value, collaboratorId);
    const before = await petRow();
    const membersBefore = await memberships();
    const invitationsBefore = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.petId, pet.id.value))
      .orderBy(petInvitations.id);
    await restore.execute({ petId: pet.id.value, requesterAccountId: ownerId });
    const after = await petRow();
    expect(after).toEqual({
      ...before,
      status: 'ACTIVE',
      updatedAt: expect.any(Date) as Date,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    expect(await memberships()).toEqual(membersBefore);
    expect(
      await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.petId, pet.id.value))
        .orderBy(petInvitations.id),
    ).toEqual(invitationsBefore);
    await withoutRedundantUpdates(async () => {
      await restore.execute({
        petId: pet.id.value,
        requesterAccountId: ownerId,
      });
    });
    expect(await petRow()).toEqual(after);
    expect(
      await queries.findAccessibleDetailById(pet.id.value, ownerId),
    ).toMatchObject({ status: 'ACTIVE' });
    expect(await queries.findAccessibleByAccountId(ownerId)).toEqual([
      expect.objectContaining({ id: pet.id.value, status: 'ACTIVE' }),
    ]);
    expect(
      await queries.findAccessibleMembers(pet.id.value, ownerId),
    ).toHaveLength(1);
  });

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'conceals %s pets on unauthorized requests and retries',
    async (status) => {
      if (status === 'ARCHIVED') await act('archive');
      for (const requesterAccountId of [
        collaboratorId,
        recipientId,
        randomUUID(),
      ])
        await expect(
          restore.execute({ petId: pet.id.value, requesterAccountId }),
        ).rejects.toBeInstanceOf(PetNotFoundError);
      await repository.leave(pet.id.value, ownerId);
      await repository.leave(pet.id.value, collaboratorId);
      for (const requesterAccountId of [ownerId, collaboratorId])
        await expect(
          restore.execute({ petId: pet.id.value, requesterAccountId }),
        ).rejects.toBeInstanceOf(PetNotFoundError);
      await expect(
        restore.execute({
          petId: randomUUID(),
          requesterAccountId: otherOwnerId,
        }),
      ).rejects.toBeInstanceOf(PetNotFoundError);
    },
  );

  it('rolls back a failed restore', async () => {
    await act('archive');
    const before = await petRow();
    await database.connection.execute(
      sql.raw(
        `ALTER TABLE pets ADD CONSTRAINT test_restore_rollback CHECK (id <> '${pet.id.value}'::uuid OR status <> 'ACTIVE')`,
      ),
    );
    try {
      await expect(act('restore')).rejects.toThrow();
      expect(await petRow()).toEqual(before);
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pets DROP CONSTRAINT test_restore_rollback`,
      );
    }
  });

  it.each([false, true])(
    'serializes restores with another owner=%s and exactly one physical update',
    async (isOtherOwner) => {
      await act('archive');
      await withoutRedundantUpdates(async () => {
        const results = await race(
          () => act('restore'),
          () =>
            repository.restoreIfOwned({
              petId: pet.id.value,
              requesterAccountId: isOtherOwner ? otherOwnerId : ownerId,
            }),
        );
        expect(results).toEqual([
          { value: { outcome: 'RESTORED' } },
          { value: { outcome: 'ALREADY_ACTIVE' } },
        ]);
        const after = await petRow();
        await restore.execute({
          petId: pet.id.value,
          requesterAccountId: otherOwnerId,
        });
        expect(await petRow()).toEqual(after);
      });
    },
  );

  const operations: Action[] = [
    'archive',
    'leave',
    'remove',
    'promote',
    'profile',
    'invite',
    'accept',
    'weight',
  ];
  it.each(operations)('serializes Restore before %s', async (action) => {
    if (action === 'invite')
      await database.connection
        .delete(petInvitations)
        .where(eq(petInvitations.id, pending.id.value));
    await act('archive');
    const results = await race(
      () => act('restore'),
      () => act(action),
    );
    expect(results[0]).toEqual({ value: { outcome: 'RESTORED' } });
    expect(results[1].error).toBeUndefined();
    expect((await petRow()).status).toBe(
      action === 'archive' ? 'ARCHIVED' : 'ACTIVE',
    );
    switch (action) {
      case 'archive':
        expect(results[1].value).toEqual({ outcome: 'ARCHIVED' });
        break;
      case 'leave':
        expect(results[1].value).toEqual({ outcome: 'LEFT' });
        expect(await act('restore')).toEqual({ outcome: 'PET_NOT_FOUND' });
        break;
      case 'remove':
        expect(results[1].value).toEqual({ outcome: 'REMOVED' });
        break;
      case 'promote':
        expect(results[1].value).toEqual({ outcome: 'PROMOTED' });
        break;
      case 'profile':
        expect((await petRow()).name).toBe('Updated profile');
        break;
      case 'invite':
        expect(results[1].value).toBe('CREATED');
        break;
      case 'accept':
        expect(results[1].value).toMatchObject({ outcome: 'ACCEPTED' });
        break;
      case 'weight':
        expect(
          await database.connection
            .select()
            .from(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, pet.id.value)),
        ).toHaveLength(1);
        break;
    }
  });
  it.each(operations)('serializes %s before Restore', async (action) => {
    if (action === 'invite')
      await database.connection
        .delete(petInvitations)
        .where(eq(petInvitations.id, pending.id.value));
    await act('archive');
    const before = await memberships();
    const results = await race(
      () => act(action),
      () => act('restore'),
    );
    expect(results[1]).toEqual({
      value: { outcome: action === 'leave' ? 'PET_NOT_FOUND' : 'RESTORED' },
    });
    expect((await petRow()).status).toBe(
      action === 'leave' ? 'ARCHIVED' : 'ACTIVE',
    );
    switch (action) {
      case 'archive':
        expect(results[0].value).toEqual({ outcome: 'ALREADY_ARCHIVED' });
        break;
      case 'leave':
        expect(results[0].value).toEqual({ outcome: 'LEFT' });
        break;
      case 'remove':
      case 'promote':
        expect(results[0].value).toEqual({ outcome: 'PET_NOT_FOUND' });
        break;
      case 'profile':
        expect(results[0].value).toBeNull();
        break;
      case 'invite':
        expect(results[0].value).toBe('PET_NOT_FOUND');
        break;
      case 'accept':
        expect(results[0].value).toEqual({ outcome: 'NOT_ACCEPTABLE' });
        break;
      case 'weight':
        expect(results[0].error).toBeInstanceOf(Error);
        expect((results[0].error as Error).message).toBe('Pet was not found');
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

  it.each([false, true])(
    'serializes expired invitation replacement, restore first=%s',
    async (isRestoreFirst) => {
      await useExpiredInvitation();
      await act('archive');
      const results = await race(
        () => act(isRestoreFirst ? 'restore' : 'invite'),
        () => act(isRestoreFirst ? 'invite' : 'restore'),
      );
      expect(results[isRestoreFirst ? 0 : 1].value).toEqual({
        outcome: 'RESTORED',
      });
      expect(results[isRestoreFirst ? 1 : 0].value).toBe(
        isRestoreFirst ? 'CREATED' : 'PET_NOT_FOUND',
      );
      const previous = await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.id, pending.id.value));
      expect(previous[0].status).toBe(isRestoreFirst ? 'EXPIRED' : 'PENDING');
    },
  );

  it.each([false, true])(
    'expires pending invitations without revival, restore first=%s',
    async (isRestoreFirst) => {
      await useExpiredInvitation();
      await act('archive');
      const results = await race(
        () => act(isRestoreFirst ? 'restore' : 'accept'),
        () => act(isRestoreFirst ? 'accept' : 'restore'),
      );
      expect(results[isRestoreFirst ? 1 : 0].value).toEqual({
        outcome: 'EXPIRED',
      });
      expect(results[isRestoreFirst ? 0 : 1].value).toEqual({
        outcome: 'RESTORED',
      });
      expect(await act('accept')).toEqual({ outcome: 'EXPIRED' });
    },
  );

  it('allows a still-pending invitation after a rejected archived attempt and Restore', async () => {
    await act('archive');
    const before = await memberships();
    expect(await act('accept')).toEqual({ outcome: 'NOT_ACCEPTABLE' });
    expect(await memberships()).toEqual(before);
    await act('restore');
    expect(await act('accept')).toMatchObject({ outcome: 'ACCEPTED' });
  });

  it.each([false, true])(
    'coordinates a different requester leaving, restore first=%s',
    async (isRestoreFirst) => {
      await act('archive');
      const restoreByOtherOwner = (): Promise<unknown> =>
        repository.restoreIfOwned({
          petId: pet.id.value,
          requesterAccountId: otherOwnerId,
        });
      const results = await race(
        () => (isRestoreFirst ? restoreByOtherOwner() : act('leave')),
        () => (isRestoreFirst ? act('leave') : restoreByOtherOwner()),
      );
      expect(results[isRestoreFirst ? 0 : 1]).toEqual({
        value: { outcome: 'RESTORED' },
      });
      expect(results[isRestoreFirst ? 1 : 0]).toEqual({
        value: { outcome: 'LEFT' },
      });
      expect((await petRow()).status).toBe('ACTIVE');
      expect(
        (await memberships()).find(
          (membership) => membership.accountId === ownerId,
        )?.status,
      ).toBe('INACTIVE');
    },
  );

  it('does not revive a pending invitation that expires while the pet is archived', async () => {
    await act('archive');
    currentTime = new Date(NOW.getTime() + 8 * 86400000);
    const before = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.id, pending.id.value));
    await act('restore');
    expect(
      await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.id, pending.id.value)),
    ).toEqual(before);
    expect(await act('accept')).toEqual({ outcome: 'EXPIRED' });
    expect(
      (
        await database.connection
          .select()
          .from(petInvitations)
          .where(eq(petInvitations.id, pending.id.value))
      )[0].status,
    ).toBe('EXPIRED');
    expect(
      (await memberships()).some(
        (membership) => membership.accountId === recipientId,
      ),
    ).toBe(false);
  });

  it('revalidates a restored owner after removal', async () => {
    await act('archive');
    const ownerMembership = (await memberships()).find(
      (membership) => membership.accountId === ownerId,
    );
    if (ownerMembership === undefined) throw new Error('Owner missing');
    const results = await race(
      () => act('restore'),
      () =>
        repository.removeMemberIfOwned({
          petId: pet.id.value,
          requesterAccountId: otherOwnerId,
          targetMembershipId: ownerMembership.id,
        }),
    );
    expect(results).toEqual([
      { value: { outcome: 'RESTORED' } },
      { value: { outcome: 'REMOVED' } },
    ]);
    expect(await act('restore')).toEqual({ outcome: 'PET_NOT_FOUND' });
  });
});
