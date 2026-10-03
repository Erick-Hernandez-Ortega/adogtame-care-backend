import {
  RemoveCollaborator,
  PetMemberNotFoundError,
  OwnerRemovalNotSupportedError,
} from '../../src/pet-management/application/remove-collaborator/remove-collaborator';
import { ListPetMembers } from '../../src/pet-management/application/list-pet-members/list-pet-members';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { AcceptInvitation } from '../../src/pet-management/application/accept-invitation/accept-invitation';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import { LeavePetAsCollaborator } from '../../src/pet-management/application/leave-pet-as-collaborator/leave-pet-as-collaborator';
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

describe('RemoveCollaborator with PostgreSQL (integration)', () => {
  let remove: RemoveCollaborator;
  let listMembers: ListPetMembers;
  let petIds: string[];
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
    remove = application.get(RemoveCollaborator);
    listMembers = application.get(ListPetMembers);
    leave = application.get(LeavePetAsCollaborator);
    accept = application.get(AcceptInvitation);
    invitationRepository = application.get(DrizzlePetInvitationRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    petIds = [];
    ownerId = randomUUID();
    collaboratorId = randomUUID();
    collaboratorEmail = `remove-${randomUUID()}@example.com`;
    membershipId = randomUUID();
    await database.connection.insert(accounts).values({
      id: ownerId,
      email: `remove-owner-${ownerId}@example.com`,
      passwordHash: '$argon2id$test-hash',
    });
    await database.connection.insert(accounts).values({
      id: collaboratorId,
      email: collaboratorEmail,
      passwordHash: '$argon2id$test-hash',
    });
    pet = Pet.register({
      name: 'Remove pet',
      species: 'DOG',
      breed: Breed.custom('Mixed'),
      sex: 'UNKNOWN',
      birthInformation: BirthInformation.approximate('2020-01-01'),
      ownerAccountId: ownerId,
    });
    await new DrizzlePetRepository(database).save(pet);
    petIds.push(pet.id.value);
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
      .where(inArray(accounts.id, [collaboratorId, ownerId]));
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

  function removeTarget(
    requesterAccountId: string = ownerId,
    targetMembershipId: string = membershipId,
    petId: string = pet.id.value,
  ): Promise<void> {
    return remove.execute({ requesterAccountId, targetMembershipId, petId });
  }

  async function allMemberships() {
    return database.connection
      .select()
      .from(petMemberships)
      .where(inArray(petMemberships.petId, petIds));
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

  it('preserves membership and invitation history, hides removed members, and retries without an UPDATE', async () => {
    await addMembership();
    const invitation = await createInvitation();
    const before = await allMemberships();
    const invitationBefore = await database.connection
      .select()
      .from(petInvitations)
      .where(eq(petInvitations.id, invitation.id.value));
    await removeTarget();
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: membershipId,
      petId: pet.id.value,
      accountId: collaboratorId,
      role: 'COLLABORATOR',
      status: 'INACTIVE',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect(after[0].updatedAt.getTime()).toBeGreaterThan(
      Date.parse('2020-01-01T00:00:00.000Z'),
    );
    expect(
      (await allMemberships()).filter(
        (membership) => membership.id !== membershipId,
      ),
    ).toEqual(before.filter((membership) => membership.id !== membershipId));
    expect(
      await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.id, invitation.id.value)),
    ).toEqual(invitationBefore);
    expect(
      (await listMembers.execute(pet.id.value, ownerId)).members.map(
        (member) => member.membershipId,
      ),
    ).not.toContain(membershipId);
    await database.connection.execute(
      sql`ALTER TABLE pet_memberships ADD CONSTRAINT test_remove_retry_no_update CHECK (status <> 'INACTIVE') NOT VALID`,
    );
    try {
      await expect(removeTarget()).resolves.toBeUndefined();
    } finally {
      await database.connection.execute(
        sql`ALTER TABLE pet_memberships DROP CONSTRAINT test_remove_retry_no_update`,
      );
    }
    expect(await rows()).toEqual(after);
    await accept.execute(invitation.id.value, collaboratorId);
    expect((await rows())[0]).toMatchObject({
      id: membershipId,
      accountId: collaboratorId,
      role: 'COLLABORATOR',
      status: 'ACTIVE',
    });
  });

  it.each([
    'collaborator',
    'inactive owner',
    'absent membership',
    'missing pet',
    'archived pet',
  ] as const)(
    'hides %s before resolving targets, including an inactive retry',
    async (scenario) => {
      await addMembership('INACTIVE');
      let requesterAccountId: string = ownerId;
      let requestedPetId: string = pet.id.value;
      if (scenario === 'collaborator') {
        await database.connection
          .update(petMemberships)
          .set({ status: 'ACTIVE' })
          .where(eq(petMemberships.id, membershipId));
        requesterAccountId = collaboratorId;
      }
      if (scenario === 'inactive owner')
        await database.connection
          .update(petMemberships)
          .set({ status: 'INACTIVE' })
          .where(eq(petMemberships.id, pet.memberships[0].id.value));
      if (scenario === 'absent membership') requesterAccountId = randomUUID();
      if (scenario === 'missing pet') requestedPetId = randomUUID();
      if (scenario === 'archived pet')
        await database.connection
          .update(pets)
          .set({ status: 'ARCHIVED' })
          .where(eq(pets.id, pet.id.value));
      const before = await allMemberships();
      for (const targetMembershipId of [
        membershipId,
        randomUUID(),
        pet.memberships[0].id.value,
      ]) {
        await expect(
          removeTarget(requesterAccountId, targetMembershipId, requestedPetId),
        ).rejects.toThrow(PetNotFoundError);
      }
      expect(await allMemberships()).toEqual(before);
    },
  );

  it('rechecks requester authority on a retry after a successful removal', async () => {
    await addMembership();
    await removeTarget();
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, pet.memberships[0].id.value));
    const before = await rows();
    await expect(removeTarget()).rejects.toThrow(PetNotFoundError);
    expect(await rows()).toEqual(before);
  });

  it('does not mutate an active target on an archived pet', async () => {
    await addMembership();
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, pet.id.value));
    const before = await rows();
    await expect(removeTarget()).rejects.toThrow(PetNotFoundError);
    expect(await rows()).toEqual(before);
  });

  it('hides absent targets and targets from another pet', async () => {
    const otherPet: Pet = Pet.register({
      name: 'Other pet',
      species: 'CAT',
      breed: Breed.custom('Mixed'),
      sex: 'UNKNOWN',
      birthInformation: BirthInformation.exact('2020-01-01'),
      ownerAccountId: ownerId,
    });
    await new DrizzlePetRepository(database).save(otherPet);
    petIds.push(otherPet.id.value);
    const before = await allMemberships();
    for (const target of [randomUUID(), otherPet.memberships[0].id.value])
      await expect(removeTarget(ownerId, target)).rejects.toThrow(
        PetMemberNotFoundError,
      );
    expect(await allMemberships()).toEqual(before);
  });

  it.each(['ACTIVE', 'INACTIVE'] as const)(
    'rejects a second %s owner and self-target without modifying owners',
    async (status) => {
      await addMembership(status);
      await database.connection
        .update(petMemberships)
        .set({ role: 'OWNER' })
        .where(eq(petMemberships.id, membershipId));
      const before = await allMemberships();
      for (const target of [membershipId, pet.memberships[0].id.value])
        await expect(removeTarget(ownerId, target)).rejects.toThrow(
          OwnerRemovalNotSupportedError,
        );
      expect(await allMemberships()).toEqual(before);
    },
  );

  it.each(['archive', 'requester inactivation'] as const)(
    'observes concurrent %s before authorization even on an inactive target retry',
    async (action) => {
      await addMembership('INACTIVE');
      const before = await rows();
      let release: (() => void) | undefined;
      let acquired: (() => void) | undefined;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const blocker = database.connection.transaction(async (transaction) => {
        if (action === 'archive') {
          await transaction
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, pet.id.value));
        } else {
          await transaction
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, pet.memberships[0].id.value));
        }
        acquired?.();
        await barrier;
      });
      await locked;
      const result: Promise<unknown> = removeTarget().catch(
        (error: unknown): unknown => error,
      );
      try {
        await waitForLock(action === 'archive' ? 'pets' : 'pet_memberships');
      } finally {
        release?.();
        await blocker;
      }
      expect(await result).toBeInstanceOf(PetNotFoundError);
      expect(await rows()).toEqual(before);
    },
  );

  it.each(['crossed owners', 'distinct collaborators'] as const)(
    'serializes two owners targeting %s behind the Pet lock',
    async (scenario) => {
      const secondOwnerAccountId: string = randomUUID();
      const secondOwnerMembershipId: string = randomUUID();
      await database.connection.insert(petMemberships).values({
        id: secondOwnerMembershipId,
        petId: pet.id.value,
        accountId: secondOwnerAccountId,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      const secondCollaboratorMembershipId: string = randomUUID();
      if (scenario === 'distinct collaborators') {
        await addMembership();
        await database.connection.insert(petMemberships).values({
          id: secondCollaboratorMembershipId,
          petId: pet.id.value,
          accountId: randomUUID(),
          role: 'COLLABORATOR',
          status: 'ACTIVE',
        });
      }
      const before = await allMemberships();
      let release: (() => void) | undefined;
      let acquired: (() => void) | undefined;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const blocker = database.connection.transaction(async (transaction) => {
        await transaction
          .select({ id: pets.id })
          .from(pets)
          .where(eq(pets.id, pet.id.value))
          .for('update');
        acquired?.();
        await barrier;
      });
      await locked;
      const first = removeTarget(
        ownerId,
        scenario === 'crossed owners' ? secondOwnerMembershipId : membershipId,
      ).catch((error: unknown): unknown => error);
      let second: Promise<unknown> | undefined;
      try {
        await waitForLock('pets');
        second = removeTarget(
          secondOwnerAccountId,
          scenario === 'crossed owners'
            ? pet.memberships[0].id.value
            : secondCollaboratorMembershipId,
        ).catch((error: unknown): unknown => error);
        await waitForLock('pets', 2);
      } finally {
        release?.();
        await blocker;
      }
      const results: unknown[] = await Promise.all([first, second]);
      if (scenario === 'crossed owners') {
        for (const result of results)
          expect(result).toBeInstanceOf(OwnerRemovalNotSupportedError);
        expect(await allMemberships()).toEqual(before);
      } else {
        expect(results).toEqual([undefined, undefined]);
        const after = await allMemberships();
        expect(
          after.filter((membership) => membership.role === 'OWNER'),
        ).toEqual(before.filter((membership) => membership.role === 'OWNER'));
        expect(
          after
            .filter((membership) => membership.role === 'COLLABORATOR')
            .map((membership): string => membership.status),
        ).toEqual(['INACTIVE', 'INACTIVE']);
      }
    },
  );

  it.each([
    ['remove', 'remove', 'ACTIVE', 'INACTIVE'],
    ['remove', 'leave', 'ACTIVE', 'INACTIVE'],
    ['leave', 'remove', 'ACTIVE', 'INACTIVE'],
    ['remove', 'accept', 'ACTIVE', 'ACTIVE'],
    ['accept', 'remove', 'INACTIVE', 'INACTIVE'],
  ] as const)(
    'serializes %s before %s with preserved identity and no deadlock',
    async (firstAction, secondAction, initialStatus, finalStatus) => {
      await addMembership(initialStatus);
      const invitation = await createInvitation();
      let release: (() => void) | undefined;
      let acquired: (() => void) | undefined;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const blocker = database.connection.transaction(async (transaction) => {
        await transaction
          .select({ id: petMemberships.id })
          .from(petMemberships)
          .where(eq(petMemberships.id, membershipId))
          .for('update');
        acquired?.();
        await barrier;
      });
      await locked;
      const act = (action: 'remove' | 'leave' | 'accept'): Promise<unknown> => {
        switch (action) {
          case 'remove':
            return removeTarget();
          case 'leave':
            return leave.execute(pet.id.value, collaboratorId);
          case 'accept':
            return accept.execute(invitation.id.value, collaboratorId);
        }
      };
      const first: Promise<unknown> = act(firstAction);
      let second: Promise<unknown> | undefined;
      try {
        await waitForLock('pet_memberships');
        second = act(secondAction);
        await waitForLock(
          secondAction === 'leave' || firstAction === 'leave'
            ? 'pet_memberships'
            : 'pets',
          secondAction === 'leave' || firstAction === 'leave' ? 2 : 1,
        );
      } finally {
        release?.();
        await blocker;
      }
      await Promise.all([first, second]);
      const after = await rows();
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        id: membershipId,
        accountId: collaboratorId,
        role: 'COLLABORATOR',
        status: finalStatus,
      });
      if (secondAction !== 'accept' && firstAction !== 'accept') {
        const unchanged = await rows();
        await removeTarget();
        expect(await rows()).toEqual(unchanged);
      } else {
        expect(
          (
            await database.connection
              .select()
              .from(petInvitations)
              .where(eq(petInvitations.id, invitation.id.value))
          )[0].status,
        ).toBe('ACCEPTED');
      }
    },
  );
});
