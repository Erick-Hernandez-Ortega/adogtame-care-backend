import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { AcceptInvitation } from '../../src/pet-management/application/accept-invitation/accept-invitation';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import { LeavePet } from '../../src/pet-management/application/leave-pet/leave-pet';
import { ListPetMembers } from '../../src/pet-management/application/list-pet-members/list-pet-members';
import {
  PetMemberInactiveError,
  PromoteCollaboratorToOwner,
} from '../../src/pet-management/application/promote-collaborator-to-owner/promote-collaborator-to-owner';
import {
  PetMemberNotFoundError,
  OwnerRemovalNotSupportedError,
  RemoveCollaborator,
} from '../../src/pet-management/application/remove-collaborator/remove-collaborator';
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

const NOW: Date = new Date('2026-09-27T12:30:00.000Z');

describe('PromoteCollaboratorToOwner with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let promote: PromoteCollaboratorToOwner;
  let remove: RemoveCollaborator;
  let leave: LeavePet;
  let accept: AcceptInvitation;
  let listMembers: ListPetMembers;
  let invitationRepository: DrizzlePetInvitationRepository;
  let pet: Pet;
  let petIds: string[];
  let accountIds: string[];
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
    promote = application.get(PromoteCollaboratorToOwner);
    remove = application.get(RemoveCollaborator);
    leave = application.get(LeavePet);
    accept = application.get(AcceptInvitation);
    listMembers = application.get(ListPetMembers);
    invitationRepository = application.get(DrizzlePetInvitationRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    petIds = [];
    accountIds = [];
    ownerId = await addAccount('owner');
    collaboratorId = await addAccount('collaborator');
    collaboratorEmail = `collaborator-${collaboratorId}@example.com`;
    membershipId = randomUUID();
    pet = await addPet(ownerId);
  });

  afterEach(async () => {
    await database.connection
      .delete(petInvitations)
      .where(inArray(petInvitations.petId, petIds));
    await database.connection
      .delete(petMemberships)
      .where(inArray(petMemberships.petId, petIds));
    await database.connection.delete(pets).where(inArray(pets.id, petIds));
    await database.connection
      .delete(accounts)
      .where(inArray(accounts.id, accountIds));
  });

  async function addAccount(label: string): Promise<string> {
    const accountId: string = randomUUID();
    await database.connection.insert(accounts).values({
      id: accountId,
      email: `${label}-${accountId}@example.com`,
      passwordHash: '$argon2id$test-hash',
    });
    accountIds.push(accountId);
    return accountId;
  }

  async function addPet(ownerAccountId: string): Promise<Pet> {
    const registeredPet: Pet = Pet.register({
      name: 'Promote pet',
      species: 'DOG',
      breed: Breed.custom('Mixed'),
      sex: 'UNKNOWN',
      birthInformation: BirthInformation.exact('2020-01-01'),
      ownerAccountId,
    });
    await new DrizzlePetRepository(database).save(registeredPet);
    petIds.push(registeredPet.id.value);
    return registeredPet;
  }

  async function addMembership(
    role: 'OWNER' | 'COLLABORATOR' = 'COLLABORATOR',
    status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  ): Promise<void> {
    await database.connection.insert(petMemberships).values({
      id: membershipId,
      petId: pet.id.value,
      accountId: collaboratorId,
      role,
      status,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    });
  }

  async function targetRows() {
    return database.connection
      .select()
      .from(petMemberships)
      .where(eq(petMemberships.id, membershipId));
  }

  function promoteTarget(
    requesterAccountId: string = ownerId,
    targetMembershipId: string = membershipId,
    requestedPetId: string = pet.id.value,
  ): Promise<void> {
    return promote.execute({
      requesterAccountId,
      targetMembershipId,
      petId: requestedPetId,
    });
  }

  async function createInvitation(): Promise<PetInvitation> {
    const invitation: PetInvitation = PetInvitation.create({
      petId: pet.id,
      invitedEmail: InvitedEmail.from(collaboratorEmail),
      invitedByAccountId: AccountId.from(ownerId),
      createdAt: new Date(NOW.getTime() - 86_400_000),
    });
    await invitationRepository.createPending(invitation, null);
    return invitation;
  }

  async function waitForLock(
    table: 'pets' | 'pet_memberships',
    expected: number = 1,
  ): Promise<void> {
    const deadline: number = Date.now() + 5000;
    while (Date.now() < deadline) {
      const results = await database.connection.execute(
        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE ${'%"' + table + '"%'}`,
      );
      if (Number(results[0]?.waiting ?? 0) >= expected) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected ${expected} lock waiters on ${table}`);
  }

  it('promotes in place, exposes the new owner, and retries without an UPDATE', async () => {
    await addMembership();
    await promoteTarget();
    const promoted = (await targetRows())[0];
    expect(promoted).toMatchObject({
      id: membershipId,
      petId: pet.id.value,
      accountId: collaboratorId,
      role: 'OWNER',
      status: 'ACTIVE',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect(promoted.updatedAt.getTime()).toBeGreaterThan(
      Date.parse('2020-01-01T00:00:00.000Z'),
    );
    const members = await listMembers.execute(pet.id.value, ownerId);
    expect(
      members.members.find((member) => member.membershipId === membershipId)
        ?.role,
    ).toBe('OWNER');
    expect(
      members.members.filter((member) => member.role === 'OWNER'),
    ).toHaveLength(2);
    await database.connection.execute(
      sql`ALTER TABLE pet_memberships ADD CONSTRAINT test_promote_retry_no_update CHECK (role <> 'OWNER') NOT VALID`,
    );
    try {
      await promoteTarget();
      await promoteTarget(ownerId, pet.memberships[0].id.value);
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pet_memberships DROP CONSTRAINT test_promote_retry_no_update`,
      );
    }
    expect((await targetRows())[0]).toEqual(promoted);
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, pet.memberships[0].id.value));
    await expect(promoteTarget()).rejects.toThrow(PetNotFoundError);
  });

  it.each(['COLLABORATOR', 'OWNER'] as const)(
    'rejects an inactive %s without changing it',
    async (role) => {
      await addMembership(role, 'INACTIVE');
      const before = await targetRows();
      await expect(promoteTarget()).rejects.toThrow(PetMemberInactiveError);
      expect(await targetRows()).toEqual(before);
    },
  );

  it('treats another active owner and self-target as unchanged', async () => {
    await addMembership('OWNER');
    const before = await targetRows();
    const requesterRows = await database.connection
      .select()
      .from(petMemberships)
      .where(eq(petMemberships.id, pet.memberships[0].id.value));
    await database.connection.execute(
      sql`ALTER TABLE pet_memberships ADD CONSTRAINT test_promote_existing_owner_no_update CHECK (role <> 'OWNER') NOT VALID`,
    );
    try {
      await promoteTarget();
      await promoteTarget(ownerId, pet.memberships[0].id.value);
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pet_memberships DROP CONSTRAINT test_promote_existing_owner_no_update`,
      );
    }
    expect(await targetRows()).toEqual(before);
    expect(
      await database.connection
        .select()
        .from(petMemberships)
        .where(eq(petMemberships.id, pet.memberships[0].id.value)),
    ).toEqual(requesterRows);
  });

  it.each([
    'collaborator',
    'inactive owner',
    'outsider',
    'missing pet',
    'archived pet',
  ] as const)('hides %s before resolving the target', async (scenario) => {
    await addMembership();
    let requesterAccountId: string = ownerId;
    let requestedPetId: string = pet.id.value;
    if (scenario === 'collaborator') requesterAccountId = collaboratorId;
    if (scenario === 'inactive owner')
      await database.connection
        .update(petMemberships)
        .set({ status: 'INACTIVE' })
        .where(eq(petMemberships.id, pet.memberships[0].id.value));
    if (scenario === 'outsider') requesterAccountId = randomUUID();
    if (scenario === 'missing pet') requestedPetId = randomUUID();
    if (scenario === 'archived pet')
      await database.connection
        .update(pets)
        .set({ status: 'ARCHIVED' })
        .where(eq(pets.id, pet.id.value));
    const before = await targetRows();
    await expect(
      promoteTarget(requesterAccountId, randomUUID(), requestedPetId),
    ).rejects.toThrow(PetNotFoundError);
    expect(await targetRows()).toEqual(before);
  });

  it('hides missing and cross-pet targets after authorization', async () => {
    const otherPet: Pet = await addPet(ownerId);
    await expect(promoteTarget(ownerId, randomUUID())).rejects.toThrow(
      PetMemberNotFoundError,
    );
    await expect(
      promoteTarget(ownerId, otherPet.memberships[0].id.value),
    ).rejects.toThrow(PetMemberNotFoundError);
  });

  it('serializes two owners promoting the same collaborator with one update', async () => {
    await addMembership();
    const secondOwnerId: string = await addAccount('second-owner');
    await database.connection.insert(petMemberships).values({
      id: randomUUID(),
      petId: pet.id.value,
      accountId: secondOwnerId,
      role: 'OWNER',
      status: 'ACTIVE',
    });
    const releaseAndWait = await blockRow('pets', pet.id.value);
    const first = promoteTarget();
    let second: Promise<void> | undefined;
    try {
      await waitForLock('pets');
      second = promoteTarget(secondOwnerId);
      await waitForLock('pets', 2);
    } finally {
      await releaseAndWait();
    }
    await Promise.all([first, second]);
    expect((await targetRows())[0].role).toBe('OWNER');
  });

  async function blockRow(
    table: 'pets' | 'pet_memberships',
    id: string,
  ): Promise<() => Promise<void>> {
    let release: (() => void) | undefined;
    let acquired: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const blocker = database.connection.transaction(async (transaction) => {
      if (table === 'pets')
        await transaction
          .select({ id: pets.id })
          .from(pets)
          .where(eq(pets.id, id))
          .for('update');
      else
        await transaction
          .select({ id: petMemberships.id })
          .from(petMemberships)
          .where(eq(petMemberships.id, id))
          .for('update');
      acquired?.();
      await barrier;
    });
    await locked;
    return async (): Promise<void> => {
      release?.();
      await blocker;
    };
  }

  it.each(['promote', 'remove'] as const)(
    'serializes %s first against Remove Collaborator',
    async (firstAction) => {
      await addMembership();
      const releaseAndWait = await blockRow('pets', pet.id.value);
      const act = (action: 'promote' | 'remove'): Promise<unknown> =>
        action === 'promote'
          ? promoteTarget()
          : remove.execute({
              requesterAccountId: ownerId,
              petId: pet.id.value,
              targetMembershipId: membershipId,
            });
      const first = act(firstAction).catch((error: unknown): unknown => error);
      let second: Promise<unknown> | undefined;
      try {
        await waitForLock('pets');
        second = act(firstAction === 'promote' ? 'remove' : 'promote').catch(
          (error: unknown): unknown => error,
        );
        await waitForLock('pets', 2);
      } finally {
        await releaseAndWait();
      }
      const results: unknown[] = await Promise.all([first, second]);
      expect(results[0]).toBeUndefined();
      expect(results[1]).toBeInstanceOf(
        firstAction === 'promote'
          ? OwnerRemovalNotSupportedError
          : PetMemberInactiveError,
      );
      expect((await targetRows())[0]).toMatchObject({
        role: firstAction === 'promote' ? 'OWNER' : 'COLLABORATOR',
        status: firstAction === 'promote' ? 'ACTIVE' : 'INACTIVE',
      });
    },
  );

  it.each(['promote', 'leave'] as const)(
    'serializes %s first against Collaborator Leave',
    async (firstAction) => {
      await addMembership();
      const releaseAndWait = await blockRow('pets', pet.id.value);
      const act = (action: 'promote' | 'leave'): Promise<unknown> =>
        action === 'promote'
          ? promoteTarget()
          : leave.execute(pet.id.value, collaboratorId);
      const first = act(firstAction).catch((error: unknown): unknown => error);
      let second: Promise<unknown> | undefined;
      try {
        await waitForLock('pets');
        second = act(firstAction === 'promote' ? 'leave' : 'promote').catch(
          (error: unknown): unknown => error,
        );
        await waitForLock('pets', 2);
      } finally {
        await releaseAndWait();
      }
      const results: unknown[] = await Promise.all([first, second]);
      if (firstAction === 'promote') {
        expect(results[0]).toBeUndefined();
        expect(results[1]).toBeUndefined();
      } else {
        expect(results[0]).toBeUndefined();
        expect(results[1]).toBeInstanceOf(PetMemberInactiveError);
      }
      expect((await targetRows())[0]).toMatchObject({
        role: firstAction === 'promote' ? 'OWNER' : 'COLLABORATOR',
        status: 'INACTIVE',
      });
    },
  );

  it.each(['promote', 'accept'] as const)(
    'serializes %s first against Accept Invitation',
    async (firstAction) => {
      await addMembership('COLLABORATOR', 'INACTIVE');
      const invitation: PetInvitation = await createInvitation();
      const releaseAndWait = await blockRow('pets', pet.id.value);
      const act = (action: 'promote' | 'accept'): Promise<unknown> =>
        action === 'promote'
          ? promoteTarget()
          : accept.execute(invitation.id.value, collaboratorId);
      const first = act(firstAction).catch((error: unknown): unknown => error);
      let second: Promise<unknown> | undefined;
      try {
        await waitForLock('pets');
        second = act(firstAction === 'promote' ? 'accept' : 'promote').catch(
          (error: unknown): unknown => error,
        );
        await waitForLock('pets', 2);
      } finally {
        await releaseAndWait();
      }
      const results: unknown[] = await Promise.all([first, second]);
      if (firstAction === 'promote') {
        expect(results[0]).toBeInstanceOf(PetMemberInactiveError);
        expect(results[1]).toMatchObject({ status: 'ACCEPTED' });
      } else {
        expect(results[0]).toMatchObject({ status: 'ACCEPTED' });
        expect(results[1]).toBeUndefined();
      }
      expect((await targetRows())[0]).toMatchObject({
        id: membershipId,
        accountId: collaboratorId,
        role: firstAction === 'promote' ? 'COLLABORATOR' : 'OWNER',
        status: 'ACTIVE',
      });
    },
  );
});
