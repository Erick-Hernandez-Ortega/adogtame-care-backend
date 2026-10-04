import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DeletePetAllergy } from '../../src/health/application/delete-pet-allergy/delete-pet-allergy';
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
import {
  UpdatePetAllergy,
  PetAllergyNotFoundError,
  type UpdatedPetAllergy,
} from '../../src/health/application/update-pet-allergy/update-pet-allergy';
import {
  InvalidAllergenError,
  InvalidAllergyCategoryError,
  InvalidAllergySeverityError,
  InvalidAllergyNotesError,
} from '../../src/health/application/record-pet-allergy/record-pet-allergy';
import type { PetAllergyCorrection } from '../../src/health/application/persistence/pet-allergy.repository';
import { ListPetAllergies } from '../../src/health/application/list-pet-allergies/list-pet-allergies';

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

describe('UpdatePetAllergy with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let recordPetAllergy: RecordPetAllergy;
  let updatePetAllergy: UpdatePetAllergy;
  let petId: string;
  let ownerId: string;
  let collaboratorId: string;
  let outsiderId: string;
  let collaboratorMembershipId: string;
  let otherPetId: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = fixture;
    database = application.get(DatabaseService);
    recordPetAllergy = application.get(RecordPetAllergy);
    updatePetAllergy = application.get(UpdatePetAllergy);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    petId = randomUUID();
    otherPetId = randomUUID();
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
    await database.connection.insert(pets).values(
      [petId, otherPetId].map((identifier: string) => ({
        id: identifier,
        name: 'Allergy pet',
        species: 'DOG',
        breedName: 'Mixed',
        breedKind: 'CUSTOM',
        sex: 'UNKNOWN',
        birthDate: '2020-01-01',
        birthDateAccuracy: 'EXACT',
        status: 'ACTIVE',
      })),
    );
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
      .where(inArray(healthPetAllergies.petId, [petId, otherPetId]));
    await database.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, petId));
    await database.connection
      .delete(pets)
      .where(inArray(pets.id, [petId, otherPetId]));
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

  function update(
    allergyId: string,
    patch: Partial<PetAllergyCorrection> = { severity: 'SEVERE' },
    authenticatedAccountId: string = ownerId,
  ) {
    return updatePetAllergy.execute({
      petId,
      allergyId,
      authenticatedAccountId,
      ...patch,
    });
  }
  async function physicalRow(allergyId: string) {
    const results = await database.connection.execute(
      sql`SELECT id, pet_id, recorded_by_account_id, allergen, category, severity, notes, created_at::text AS created_at, updated_at::text AS updated_at, xmin::text AS version, ctid::text AS location FROM health_pet_allergies WHERE id = ${allergyId}`,
    );
    return results[0];
  }

  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'allows active %s to correct another original author and preserves exact identity/timestamps',
    async (role) => {
      const created = await create(role === 'OWNER' ? collaboratorId : ownerId);
      const before = await physicalRow(created.id);
      const result = await update(
        created.id,
        {
          allergen: '  Penicillin  ',
          category: 'MEDICATION',
          severity: 'SEVERE',
          notes: '  Corrected  ',
        },
        role === 'OWNER' ? ownerId : collaboratorId,
      );
      expect(result).toEqual({
        ...created,
        allergen: 'Penicillin',
        category: 'MEDICATION',
        severity: 'SEVERE',
        notes: 'Corrected',
      });
      const after = await physicalRow(created.id);
      expect(after).toMatchObject({
        id: before.id,
        pet_id: before.pet_id,
        recorded_by_account_id: before.recorded_by_account_id,
        created_at: before.created_at,
      });
      expect(after.updated_at).not.toBe(before.updated_at);
      expect(after.version).not.toBe(before.version);
      await expect(
        application
          .get(ListPetAllergies)
          .execute({ petId, authenticatedAccountId: ownerId }),
      ).resolves.toEqual({
        items: [
          {
            id: created.id,
            allergen: 'Penicillin',
            category: 'MEDICATION',
            severity: 'SEVERE',
            notes: 'Corrected',
            recordedByAccountId: created.recordedByAccountId,
          },
        ],
      });
    },
  );

  it('corrects each field independently, clears notes and permits duplicate resulting data', async () => {
    const first = await create();
    const second = await create();
    let expected = first;
    const patches: Partial<UpdatedPetAllergy>[] = [
      { allergen: '  Penicillin  ' },
      { category: 'MEDICATION' },
      { severity: 'SEVERE' },
      { notes: '  Observed reaction  ' },
      { notes: null },
    ];
    for (const patch of patches) {
      const actual = await update(first.id, patch);
      expected = {
        ...expected,
        ...patch,
        allergen:
          patch.allergen === undefined
            ? expected.allergen
            : patch.allergen.trim(),
        notes:
          patch.notes === undefined
            ? expected.notes
            : (patch.notes?.trim() ?? null),
      };
      expect(actual).toEqual(expected);
    }
    await update(first.id, {
      allergen: second.allergen,
      category: second.category,
      severity: second.severity,
      notes: second.notes,
    });
    expect(
      (await rows()).map((row) => ({
        allergen: row.allergen,
        category: row.category,
        severity: row.severity,
        notes: row.notes,
      })),
    ).toEqual([
      {
        allergen: 'Chicken',
        category: 'FOOD',
        severity: 'UNKNOWN',
        notes: 'Reported reaction.',
      },
      {
        allergen: 'Chicken',
        category: 'FOOD',
        severity: 'UNKNOWN',
        notes: 'Reported reaction.',
      },
    ]);
  });

  it('skips physical UPDATE for every normalized and null no-op at PostgreSQL precision', async () => {
    const created = await create();
    const before = await physicalRow(created.id);
    for (const patch of [
      { allergen: '  Chicken  ' },
      { category: 'FOOD' },
      { severity: 'UNKNOWN' },
      { notes: '  Reported reaction.  ' },
      {
        allergen: ' Chicken ',
        category: 'FOOD',
        severity: 'UNKNOWN',
        notes: ' Reported reaction. ',
      },
    ]) {
      await expect(update(created.id, patch)).resolves.toEqual(created);
      expect(await physicalRow(created.id)).toEqual(before);
    }
    await update(created.id, { notes: null });
    const cleared = await physicalRow(created.id);
    await update(created.id, { notes: null });
    expect(await physicalRow(created.id)).toEqual(cleared);
  });

  it('changes the trigger timestamp from a fixed historical fixture without changing creation', async () => {
    const allergyId: string = randomUUID();
    await database.connection.insert(healthPetAllergies).values({
      id: allergyId,
      petId,
      allergen: 'Chicken',
      category: 'FOOD',
      severity: 'UNKNOWN',
      recordedByAccountId: ownerId,
      createdAt: new Date('2000-01-01T00:00:00Z'),
      updatedAt: new Date('2000-01-01T00:00:00Z'),
    });
    const before = await physicalRow(allergyId);
    await update(allergyId);
    const after = await physicalRow(allergyId);
    expect(after.created_at).toBe(before.created_at);
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('allows correction after the original author leaves and denies stale requester access', async () => {
    const created = await create(collaboratorId);
    await changeAccess('leave');
    await expect(update(created.id, { notes: null })).resolves.toMatchObject({
      recordedByAccountId: collaboratorId,
      notes: null,
    });
    const before = await physicalRow(created.id);
    await expect(
      update(created.id, { allergen: '' }, collaboratorId),
    ).rejects.toThrow(PetNotFoundError);
    expect(await physicalRow(created.id)).toEqual(before);
  });

  it('authorizes Pet before resolving Allergy and validates semantic values last', async () => {
    const created = await create();
    const otherAllergyId: string = randomUUID();
    await database.connection.insert(healthPetAllergies).values({
      id: otherAllergyId,
      petId: otherPetId,
      allergen: 'Chicken',
      category: 'FOOD',
      severity: 'UNKNOWN',
      recordedByAccountId: ownerId,
    });
    const before = await physicalRow(created.id);
    await expect(
      update(created.id, { allergen: '' }, outsiderId),
    ).rejects.toThrow(PetNotFoundError);
    await expect(
      update(randomUUID(), { allergen: '' }, outsiderId),
    ).rejects.toThrow(PetNotFoundError);
    await expect(
      update(created.id, { petId: randomUUID(), allergen: '' }),
    ).rejects.toThrow(PetNotFoundError);
    await expect(update(randomUUID(), { allergen: '' })).rejects.toThrow(
      PetAllergyNotFoundError,
    );
    await expect(update(otherAllergyId, { allergen: '' })).rejects.toThrow(
      PetAllergyNotFoundError,
    );
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, collaboratorMembershipId));
    await expect(
      update(created.id, { allergen: '' }, collaboratorId),
    ).rejects.toThrow(PetNotFoundError);
    await changeAccess('archive');
    await expect(update(created.id, { allergen: '' })).rejects.toThrow(
      PetNotFoundError,
    );
    expect(await physicalRow(created.id)).toEqual(before);
  });

  it.each([
    [{ allergen: '' }, InvalidAllergenError],
    [{ category: 'invalid' }, InvalidAllergyCategoryError],
    [{ severity: 'invalid' }, InvalidAllergySeverityError],
    [{ notes: ' ' }, InvalidAllergyNotesError],
    [
      { allergen: 'Penicillin', severity: 'invalid' },
      InvalidAllergySeverityError,
    ],
  ])(
    'rolls back invalid correction %j and releases locks',
    async (patch, errorClass) => {
      const created = await create();
      const before = await physicalRow(created.id);
      await expect(update(created.id, patch)).rejects.toThrow(errorClass);
      expect(await physicalRow(created.id)).toEqual(before);
      await expect(update(created.id)).resolves.toMatchObject({
        severity: 'SEVERE',
      });
    },
  );

  it.each([false, true])(
    'preserves both concurrent patches without lost updates, reverse=%s',
    async (isReverse: boolean) => {
      const created = await create(ownerId, null);
      const severityCorrection = (): Promise<unknown> =>
        update(created.id, { severity: 'SEVERE' });
      const notesCorrection = (): Promise<unknown> =>
        update(created.id, { notes: 'Observed reaction' }, collaboratorId);
      const [first, second] = await race(
        isReverse ? notesCorrection : severityCorrection,
        isReverse ? severityCorrection : notesCorrection,
      );
      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();
      expect(second.value).toMatchObject({
        severity: 'SEVERE',
        notes: 'Observed reaction',
      });
      expect(await physicalRow(created.id)).toMatchObject({
        severity: 'SEVERE',
        notes: 'Observed reaction',
        recorded_by_account_id: ownerId,
      });
    },
  );

  it.each(['archive', 'leave', 'remove'] as const)(
    'rejects Update after %s wins the Pet lock',
    async (action: AccessChange) => {
      const created = await create();
      const before = await physicalRow(created.id);
      const [change, correction] = await race(
        () => changeAccess(action),
        () => update(created.id, { severity: 'SEVERE' }, collaboratorId),
      );
      expect(change.error).toBeUndefined();
      expect(correction.error).toBeInstanceOf(PetNotFoundError);
      expect(await physicalRow(created.id)).toEqual(before);
    },
  );

  it.each(['archive', 'leave', 'remove'] as const)(
    'confirms Update before %s changes access',
    async (action: AccessChange) => {
      const created = await create();
      const [correction, change] = await race(
        () => update(created.id, { severity: 'SEVERE' }, collaboratorId),
        () => changeAccess(action),
      );
      expect(correction.error).toBeUndefined();
      expect(correction.value).toMatchObject({
        severity: 'SEVERE',
        recordedByAccountId: ownerId,
      });
      expect(change.error).toBeUndefined();
      expect(await physicalRow(created.id)).toMatchObject({
        severity: 'SEVERE',
        recorded_by_account_id: ownerId,
      });
    },
  );

  it('does not retry an archived Update when Restore later makes the Pet writable', async () => {
    const created = await create();
    await changeAccess('archive');
    const before = await physicalRow(created.id);
    await expect(update(created.id)).rejects.toThrow(PetNotFoundError);
    await changeAccess('restore');
    expect(await physicalRow(created.id)).toEqual(before);
    await expect(update(created.id)).resolves.toMatchObject({
      severity: 'SEVERE',
    });
  });
  function deleteAllergy(
    allergyId: string,
    authenticatedAccountId: string = collaboratorId,
  ): Promise<void> {
    return application.get(DeletePetAllergy).execute({
      petId,
      allergyId,
      authenticatedAccountId,
    });
  }

  it.each([false, true])(
    'serializes Delete and Update without resurrection, deleteFirst=%s',
    async (isDeleteFirst: boolean) => {
      const created = await create();
      const deletion = (): Promise<void> => deleteAllergy(created.id);
      const correction = (): Promise<UpdatedPetAllergy> => update(created.id);
      const [first, second] = await race(
        isDeleteFirst ? deletion : correction,
        isDeleteFirst ? correction : deletion,
      );
      expect(first.error).toBeUndefined();
      if (isDeleteFirst) {
        expect(second.error).toBeInstanceOf(PetAllergyNotFoundError);
      } else {
        expect(first.value).toMatchObject({
          id: created.id,
          severity: 'SEVERE',
        });
        expect(second.error).toBeUndefined();
      }
      expect(await physicalRow(created.id)).toBeUndefined();
    },
  );

  it('serializes two Deletes into one success and one missing target', async () => {
    const created = await create();
    const [first, second] = await race(
      () => deleteAllergy(created.id, ownerId),
      () => deleteAllergy(created.id, collaboratorId),
    );
    expect(first.error).toBeUndefined();
    expect(second.error).toBeInstanceOf(PetAllergyNotFoundError);
    expect(await physicalRow(created.id)).toBeUndefined();
  });

  it.each(['archive', 'leave', 'remove'] as const)(
    'denies Delete after %s wins the Pet lock',
    async (action: AccessChange) => {
      const created = await create();
      const before = await physicalRow(created.id);
      const [change, deletion] = await race(
        () => changeAccess(action),
        () => deleteAllergy(created.id),
      );
      expect(change.error).toBeUndefined();
      expect(deletion.error).toBeInstanceOf(PetNotFoundError);
      expect(await physicalRow(created.id)).toEqual(before);
      if (action === 'archive') {
        const listed = await application.get(ListPetAllergies).execute({
          petId,
          authenticatedAccountId: ownerId,
        });
        expect(listed.items).toEqual([
          expect.objectContaining({ id: created.id }),
        ]);
      }
    },
  );

  it.each(['archive', 'leave', 'remove'] as const)(
    'confirms Delete before %s changes access',
    async (action: AccessChange) => {
      const created = await create();
      const [deletion, change] = await race(
        () => deleteAllergy(created.id),
        () => changeAccess(action),
      );
      expect(deletion.error).toBeUndefined();
      expect(change.error).toBeUndefined();
      expect(await physicalRow(created.id)).toBeUndefined();
    },
  );

  it.each([false, true])(
    'observes archived state without retry when racing Restore, deleteFirst=%s',
    async (isDeleteFirst: boolean) => {
      const created = await create();
      await changeAccess('archive');
      const before = await physicalRow(created.id);
      const deletion = (): Promise<void> => deleteAllergy(created.id);
      const restoration = (): Promise<void> => changeAccess('restore');
      const [first, second] = await race(
        isDeleteFirst ? deletion : restoration,
        isDeleteFirst ? restoration : deletion,
      );
      if (isDeleteFirst) {
        expect(first.error).toBeInstanceOf(PetNotFoundError);
        expect(second.error).toBeUndefined();
        expect(await physicalRow(created.id)).toEqual(before);
      } else {
        expect(first.error).toBeUndefined();
        expect(second.error).toBeUndefined();
        expect(await physicalRow(created.id)).toBeUndefined();
      }
    },
  );
});
