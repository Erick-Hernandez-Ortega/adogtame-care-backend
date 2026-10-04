import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
  PetNotFoundError,
  RecordPetAllergy,
} from '../../src/health/application/record-pet-allergy/record-pet-allergy';
import { healthPetAllergies } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

import { ArchivePet } from '../../src/pet-management/application/archive-pet/archive-pet';
import { RestorePet } from '../../src/pet-management/application/restore-pet/restore-pet';
import { LeavePet } from '../../src/pet-management/application/leave-pet/leave-pet';
import { RemovePetMember } from '../../src/pet-management/application/remove-pet-member/remove-pet-member';
import { DrizzlePetAllergyRepository } from '../../src/health/infrastructure/persistence/drizzle/drizzle-pet-allergy.repository';
import { Allergen } from '../../src/health/domain/allergen/allergen';
import {
  PetAllergy,
  PetId,
  RecordedByAccountId,
} from '../../src/health/domain/pet-allergy/pet-allergy';

interface Barrier {
  promise: Promise<void>;
  release: () => void;
}
function barrier(): Barrier {
  let release: () => void = (): void => {
    throw new Error('Barrier is not initialized');
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
type AccessChange = 'archive' | 'restore' | 'leave' | 'remove';

describe('RecordPetAllergy with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let recordPetAllergy: RecordPetAllergy;
  let petId: string;
  let ownerId: string;
  let collaboratorId: string;
  let outsiderId: string;
  let collaboratorMembershipId: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = fixture;
    database = application.get(DatabaseService);
    recordPetAllergy = application.get(RecordPetAllergy);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    petId = randomUUID();
    ownerId = randomUUID();
    collaboratorId = randomUUID();
    outsiderId = randomUUID();
    collaboratorMembershipId = randomUUID();
    await database.connection.insert(accounts).values(
      [ownerId, collaboratorId, outsiderId].map((id) => ({
        id,
        email: `${id}@example.com`,
        passwordHash: 'test-hash',
      })),
    );
    await database.connection.insert(pets).values({
      id: petId,
      name: 'Allergy pet',
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
        accountId: ownerId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      {
        id: collaboratorMembershipId,
        petId,
        accountId: collaboratorId,
        role: 'COLLABORATOR',
        status: 'ACTIVE',
      },
    ]);
  });

  afterEach(async () => {
    await database.connection
      .delete(healthPetAllergies)
      .where(eq(healthPetAllergies.petId, petId));
    await database.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, petId));
    await database.connection.delete(pets).where(eq(pets.id, petId));
    for (const id of [ownerId, collaboratorId, outsiderId]) {
      await database.connection.delete(accounts).where(eq(accounts.id, id));
    }
  });

  function create(
    accountId: string = ownerId,
    notes: string | null = '  Reported reaction.  ',
  ) {
    return recordPetAllergy.execute({
      petId,
      allergen: '  Chicken  ',
      category: 'FOOD',
      severity: 'UNKNOWN',
      notes,
      authenticatedAccountId: accountId,
    });
  }
  function rows() {
    return database.connection
      .select()
      .from(healthPetAllergies)
      .where(eq(healthPetAllergies.petId, petId));
  }
  function changeAccess(action: AccessChange): Promise<void> {
    switch (action) {
      case 'archive':
        return application
          .get(ArchivePet)
          .execute({ petId, requesterAccountId: ownerId });
      case 'restore':
        return application
          .get(RestorePet)
          .execute({ petId, requesterAccountId: ownerId });
      case 'leave':
        return application.get(LeavePet).execute(petId, collaboratorId);
      case 'remove':
        return application.get(RemovePetMember).execute({
          petId,
          requesterAccountId: ownerId,
          targetMembershipId: collaboratorMembershipId,
        });
    }
  }

  async function race(
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
  ): Promise<[SettledAction, SettledAction]> {
    const acquired: Barrier = barrier();
    const released: Barrier = barrier();
    let blockerBackendId: number = 0;
    const blocker: Promise<void> = database.connection.transaction(
      async (transaction) => {
        const backendRows = await transaction.execute(
          sql`SELECT pg_backend_pid() AS id`,
        );
        blockerBackendId = Number(backendRows[0].id);
        await transaction.execute(sql`SET LOCAL statement_timeout = '8000ms'`);
        await transaction
          .select()
          .from(pets)
          .where(eq(pets.id, petId))
          .for('update');
        acquired.release();
        await released.promise;
      },
    );
    await acquired.promise;
    async function waitForWaiters(expected: number): Promise<void> {
      const deadline: number = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waitingRows = await database.connection.execute(sql`
          WITH RECURSIVE blocked AS (
            SELECT pid FROM pg_stat_activity WHERE ${blockerBackendId} = ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE pid IN (SELECT pid FROM blocked) AND wait_event_type = 'Lock' AND query ILIKE '%"pets"%'
        `);
        if (Number(waitingRows[0]?.waiting ?? 0) >= expected) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`Expected ${expected} Pet lock waiters`);
    }
    const firstResult: Promise<SettledAction> = settle(first());
    let secondResult: Promise<SettledAction> | undefined;
    try {
      await waitForWaiters(1);
      secondResult = settle(second());
      await waitForWaiters(2);
    } finally {
      released.release();
      await blocker;
      // Drain operations before fixture cleanup even if observing the locks fails.
      await firstResult;
      if (secondResult !== undefined) await secondResult;
    }
    if (secondResult === undefined)
      throw new Error('Second operation did not start');
    return Promise.all([firstResult, secondResult]);
  }

  it('persists exact normalized data for both roles, nullable notes, timestamps, and duplicates', async () => {
    const ownerRecord = await create();
    const collaboratorRecord = await create(collaboratorId, null);
    const duplicate = await create();
    expect(
      new Set([ownerRecord.id, collaboratorRecord.id, duplicate.id]).size,
    ).toBe(3);
    const persisted = await rows();
    expect(persisted).toHaveLength(3);
    for (const record of [ownerRecord, collaboratorRecord, duplicate]) {
      const row = persisted.find((candidate) => candidate.id === record.id);
      expect(row).toEqual({
        ...record,
        createdAt: expect.any(Date) as Date,
        updatedAt: expect.any(Date) as Date,
      });
      expect(row?.createdAt).toEqual(row?.updatedAt);
    }
    expect(ownerRecord).toMatchObject({
      allergen: 'Chicken',
      category: 'FOOD',
      severity: 'UNKNOWN',
      notes: 'Reported reaction.',
      petId,
      recordedByAccountId: ownerId,
    });
    expect(collaboratorRecord).toMatchObject({
      notes: null,
      recordedByAccountId: collaboratorId,
    });
  });

  it('hides missing, archived, inactive, and unjoined pets without inserting', async () => {
    await expect(create(outsiderId)).rejects.toThrow(PetNotFoundError);
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, collaboratorMembershipId));
    await expect(create(collaboratorId)).rejects.toThrow(PetNotFoundError);
    await changeAccess('archive');
    await expect(create()).rejects.toThrow(PetNotFoundError);
    await expect(
      recordPetAllergy.execute({
        petId: randomUUID(),
        allergen: 'Chicken',
        category: 'FOOD',
        severity: 'UNKNOWN',
        authenticatedAccountId: ownerId,
      }),
    ).rejects.toThrow(PetNotFoundError);
    expect(await rows()).toHaveLength(0);
  });

  it('enforces structural constraints and restricts foreign-key deletion', async () => {
    const values = {
      id: randomUUID(),
      petId,
      allergen: 'Chicken',
      category: 'FOOD',
      severity: 'UNKNOWN',
      notes: null,
      recordedByAccountId: ownerId,
    };
    for (const invalidValues of [
      { ...values, allergen: ' ' },
      { ...values, allergen: '🐕'.repeat(256) },
      { ...values, category: 'food' },
      { ...values, severity: 'CRITICAL' },
      { ...values, notes: ' ' },
      { ...values, notes: '🐕'.repeat(2001) },
      { ...values, petId: randomUUID() },
      { ...values, recordedByAccountId: randomUUID() },
    ]) {
      await expect(
        database.connection.insert(healthPetAllergies).values(invalidValues),
      ).rejects.toThrow();
    }
    expect(await rows()).toHaveLength(0);
    await database.connection.insert(healthPetAllergies).values({
      ...values,
      allergen: '🐕'.repeat(255),
      notes: '🐕'.repeat(2000),
    });
    await expect(
      database.connection.delete(accounts).where(eq(accounts.id, ownerId)),
    ).rejects.toThrow();
    await expect(
      database.connection.delete(pets).where(eq(pets.id, petId)),
    ).rejects.toThrow();
  });

  it('authorizes the explicit requester independently from authorship', async () => {
    const allergy: PetAllergy = PetAllergy.create({
      petId: PetId.from(petId),
      allergen: Allergen.from('Chicken'),
      category: 'FOOD',
      severity: 'UNKNOWN',
      recordedByAccountId: RecordedByAccountId.from(outsiderId),
    });
    const repository: DrizzlePetAllergyRepository = application.get(
      DrizzlePetAllergyRepository,
    );
    await expect(
      repository.createIfPetWritable(allergy, outsiderId),
    ).resolves.toBe('PET_NOT_FOUND');
    expect(await rows()).toHaveLength(0);
    await expect(
      repository.createIfPetWritable(allergy, ownerId),
    ).resolves.toBe('CREATED');
    expect((await rows())[0]?.recordedByAccountId).toBe(outsiderId);
  });

  it('rolls back a failed insert and releases authorization locks', async () => {
    const allergy: PetAllergy = PetAllergy.create({
      petId: PetId.from(petId),
      allergen: Allergen.from('Chicken'),
      category: 'FOOD',
      severity: 'UNKNOWN',
      recordedByAccountId: RecordedByAccountId.from(randomUUID()),
    });
    await expect(
      application
        .get(DrizzlePetAllergyRepository)
        .createIfPetWritable(allergy, ownerId),
    ).rejects.toThrow();
    expect(await rows()).toHaveLength(0);
    await expect(create()).resolves.toMatchObject({ petId });
  });

  it('reuses the existing timestamp trigger', async () => {
    const record = await create();
    const original = (await rows())[0];
    await database.connection
      .update(healthPetAllergies)
      .set({
        notes: 'Corrected via SQL',
        updatedAt: new Date('2000-01-01T00:00:00Z'),
      })
      .where(eq(healthPetAllergies.id, record.id));
    const updated = (await rows())[0];
    expect(updated?.createdAt).toEqual(original?.createdAt);
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      original?.updatedAt.getTime() ?? 0,
    );
    expect(updated?.updatedAt.toISOString()).not.toBe(
      '2000-01-01T00:00:00.000Z',
    );
  });

  it('preserves allergy data and timestamps through Archive and Restore', async () => {
    await create();
    const original = await rows();
    await changeAccess('archive');
    expect(await rows()).toEqual(original);
    await changeAccess('restore');
    expect(await rows()).toEqual(original);
  });

  it.each(['archive', 'restore', 'leave', 'remove'] as const)(
    'serializes %s before Record Allergy',
    async (action: AccessChange) => {
      if (action === 'restore') await changeAccess('archive');
      const [change, allergy] = await race(
        () => changeAccess(action),
        () => create(collaboratorId),
      );
      expect(change.error).toBeUndefined();
      if (action === 'restore') {
        expect(allergy.error).toBeUndefined();
        expect(allergy.value).toMatchObject({
          petId,
          recordedByAccountId: collaboratorId,
        });
        expect(await rows()).toHaveLength(1);
      } else {
        expect(allergy.error).toBeInstanceOf(PetNotFoundError);
        expect(await rows()).toHaveLength(0);
      }
    },
  );

  it.each(['archive', 'restore', 'leave', 'remove'] as const)(
    'serializes Record Allergy before %s',
    async (action: AccessChange) => {
      if (action === 'restore') await changeAccess('archive');
      const [allergy, change] = await race(
        () => create(collaboratorId),
        () => changeAccess(action),
      );
      expect(change.error).toBeUndefined();
      if (action === 'restore') {
        expect(allergy.error).toBeInstanceOf(PetNotFoundError);
        expect(await rows()).toHaveLength(0);
        expect(
          (
            await database.connection
              .select()
              .from(pets)
              .where(eq(pets.id, petId))
          )[0]?.status,
        ).toBe('ACTIVE');
      } else {
        expect(allergy.error).toBeUndefined();
        expect(allergy.value).toMatchObject({
          petId,
          recordedByAccountId: collaboratorId,
        });
        const persisted = await rows();
        expect(persisted).toHaveLength(1);
        expect(persisted[0]?.recordedByAccountId).toBe(collaboratorId);
      }
    },
  );
});
