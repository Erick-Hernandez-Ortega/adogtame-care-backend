import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
  PetNotFoundError,
  RecordVaccination,
} from '../../src/health/application/record-vaccination/record-vaccination';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
import { healthVaccinationRecords } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

describe('RecordVaccination with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let recordVaccination: RecordVaccination;
  let petId: string;
  let ownerId: string;
  let collaboratorId: string;
  let outsiderId: string;
  let collaboratorMembershipId: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HEALTH_CLOCK)
      .useValue({ now: (): Date => new Date('2026-09-27T00:30:00.000Z') })
      .compile();
    application = fixture;
    database = application.get(DatabaseService);
    recordVaccination = application.get(RecordVaccination);
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
      name: 'Vaccination pet',
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
      .delete(healthVaccinationRecords)
      .where(eq(healthVaccinationRecords.petId, petId));
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
    nextDueDate: string | null = '2027-09-20',
  ) {
    return recordVaccination.execute({
      petId,
      vaccineName: '  Rabies  ',
      appliedDate: '2026-09-20',
      nextDueDate,
      authenticatedAccountId: accountId,
    });
  }

  async function waitForLock(table: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const rows = await database.connection.execute(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE ${`%${table}%`}`,
      );
      if (Number(rows[0]?.waiting ?? 0) > 0) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`No waiter on ${table}`);
  }

  it('persists both roles, nullable date, authorship, timestamps, and exact duplicates', async () => {
    const ownerRecord = await create(ownerId);
    const collaboratorRecord = await create(collaboratorId, null);
    const duplicate = await create(ownerId);
    expect(
      new Set([ownerRecord.id, collaboratorRecord.id, duplicate.id]).size,
    ).toBe(3);
    expect(ownerRecord).toMatchObject({
      vaccineName: 'Rabies',
      nextDueDate: '2027-09-20',
      recordedByAccountId: ownerId,
    });
    expect(collaboratorRecord).toMatchObject({
      nextDueDate: null,
      recordedByAccountId: collaboratorId,
    });
    const rows = await database.connection
      .select()
      .from(healthVaccinationRecords)
      .where(eq(healthVaccinationRecords.petId, petId));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.nextDueDate).sort()).toEqual(
      ['2027-09-20', '2027-09-20', null].sort(),
    );
    expect(
      rows.every(
        (row) => row.createdAt instanceof Date && row.updatedAt instanceof Date,
      ),
    ).toBe(true);
    expect(rows.map((row) => row.recordedByAccountId).sort()).toEqual(
      [ownerId, ownerId, collaboratorId].sort(),
    );
  });

  it('enforces due-date, name, and foreign-key constraints', async () => {
    const values = {
      id: randomUUID(),
      petId,
      vaccineName: 'Rabies',
      appliedDate: '2026-09-20',
      nextDueDate: '2027-09-20',
      recordedByAccountId: ownerId,
    };
    await expect(
      database.connection
        .insert(healthVaccinationRecords)
        .values({ ...values, id: randomUUID(), nextDueDate: '2026-09-20' }),
    ).rejects.toThrow();
    await expect(
      database.connection
        .insert(healthVaccinationRecords)
        .values({ ...values, id: randomUUID(), vaccineName: ' ' }),
    ).rejects.toThrow();
    await expect(
      database.connection
        .insert(healthVaccinationRecords)
        .values({ ...values, id: randomUUID(), petId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      database.connection.insert(healthVaccinationRecords).values({
        ...values,
        id: randomUUID(),
        recordedByAccountId: randomUUID(),
      }),
    ).rejects.toThrow();
    await database.connection.insert(healthVaccinationRecords).values(values);
    await expect(
      database.connection.delete(accounts).where(eq(accounts.id, ownerId)),
    ).rejects.toThrow();
  });

  it('hides missing, archived, inactive, and unjoined pets', async () => {
    await expect(create(outsiderId)).rejects.toThrow(PetNotFoundError);
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, collaboratorMembershipId));
    await expect(create(collaboratorId)).rejects.toThrow(PetNotFoundError);
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, petId));
    await expect(create(ownerId)).rejects.toThrow(PetNotFoundError);
    await expect(
      recordVaccination.execute({
        petId: randomUUID(),
        vaccineName: 'Rabies',
        appliedDate: '2026-09-20',
        nextDueDate: null,
        authenticatedAccountId: ownerId,
      }),
    ).rejects.toThrow(PetNotFoundError);
    expect(
      await database.connection
        .select()
        .from(healthVaccinationRecords)
        .where(eq(healthVaccinationRecords.petId, petId)),
    ).toHaveLength(0);
  });

  it.each(['archive', 'leave'] as const)(
    'observes %s committed before its access lock',
    async (action) => {
      let release: (() => void) | undefined;
      let signalLocked: (() => void) | undefined;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const change = database.connection.transaction(async (transaction) => {
        if (action === 'archive') {
          await transaction
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        } else {
          await transaction
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        }
        signalLocked?.();
        await gate;
      });
      await locked;
      const pending = expect(
        create(action === 'archive' ? ownerId : collaboratorId),
      ).rejects.toThrow(PetNotFoundError);
      try {
        await waitForLock(action === 'archive' ? 'pets' : 'pet_memberships');
      } finally {
        release?.();
      }
      await change;
      await pending;
    },
  );

  it.each(['archive', 'leave'] as const)(
    'inserts before later %s changes access',
    async (action) => {
      let release: (() => void) | undefined;
      let signalLocked: (() => void) | undefined;
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = database.connection.transaction(async (transaction) => {
        await transaction
          .select()
          .from(accounts)
          .where(
            eq(accounts.id, action === 'archive' ? ownerId : collaboratorId),
          )
          .for('update');
        signalLocked?.();
        await gate;
      });
      await locked;
      const pending = create(action === 'archive' ? ownerId : collaboratorId);
      await waitForLock('health_vaccination_records');
      const change = database.connection.transaction(async (transaction) => {
        if (action === 'archive') {
          await transaction
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        } else {
          await transaction
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        }
      });
      try {
        await waitForLock(action === 'archive' ? 'pets' : 'pet_memberships');
      } finally {
        release?.();
      }
      await holder;
      await expect(pending).resolves.toMatchObject({ petId });
      await change;
    },
  );
});
