import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { AcceptInvitation } from '../../src/pet-management/application/accept-invitation/accept-invitation';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import {
  LeavePet,
  LastOwnerCannotLeaveError,
} from '../../src/pet-management/application/leave-pet/leave-pet';
import { ListPetMembers } from '../../src/pet-management/application/list-pet-members/list-pet-members';
import { PromoteCollaboratorToOwner } from '../../src/pet-management/application/promote-collaborator-to-owner/promote-collaborator-to-owner';
import { RemovePetMember } from '../../src/pet-management/application/remove-pet-member/remove-pet-member';
import { CLOCK } from '../../src/pet-management/application/time/clock';
import { BirthInformation } from '../../src/pet-management/domain/birth-information/birth-information';
import { Breed } from '../../src/pet-management/domain/breed/breed';
import { AccountId } from '../../src/pet-management/domain/pet-membership/pet-membership';
import type {
  PetMembershipRole,
  PetMembershipStatus,
} from '../../src/pet-management/domain/pet-membership/pet-membership.types';
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
const ORIGINAL_TIMESTAMP: Date = new Date('2020-01-01T00:00:00.000Z');

interface MemberFixture {
  accountId: string;
  membershipId: string;
  email: string;
}

type OperationResult =
  { outcome: 'SUCCEEDED' } | { outcome: 'FAILED'; error: unknown };

interface PetBlocker {
  backendId: number;
  releaseAndWait: () => Promise<void>;
}

describe('LeavePet with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let leave: LeavePet;
  let accept: AcceptInvitation;
  let promote: PromoteCollaboratorToOwner;
  let remove: RemovePetMember;
  let listMembers: ListPetMembers;
  let invitationRepository: DrizzlePetInvitationRepository;
  let pet: Pet;
  let owner: MemberFixture;
  let accountIds: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CLOCK)
      .useValue({ now: (): Date => NOW })
      .compile();
    application = moduleFixture;
    database = application.get(DatabaseService);
    leave = application.get(LeavePet);
    accept = application.get(AcceptInvitation);
    promote = application.get(PromoteCollaboratorToOwner);
    remove = application.get(RemovePetMember);
    listMembers = application.get(ListPetMembers);
    invitationRepository = application.get(DrizzlePetInvitationRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  async function createAccount(): Promise<{
    accountId: string;
    email: string;
  }> {
    const accountId: string = randomUUID();
    const email: string = `leave-${accountId}@example.com`;
    accountIds.push(accountId);
    await database.connection
      .insert(accounts)
      .values({ id: accountId, email, passwordHash: '$argon2id$test-hash' });
    return { accountId, email };
  }

  beforeEach(async () => {
    accountIds = [];
    const account = await createAccount();
    pet = Pet.register({
      name: 'Leave pet',
      species: 'DOG',
      breed: Breed.custom('Mixed'),
      sex: 'UNKNOWN',
      birthInformation: BirthInformation.approximate('2020-01-01'),
      ownerAccountId: account.accountId,
    });
    owner = { ...account, membershipId: pet.memberships[0].id.value };
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
    for (const accountId of accountIds)
      await database.connection
        .delete(accounts)
        .where(eq(accounts.id, accountId));
  });

  async function addMember(
    role: PetMembershipRole = 'COLLABORATOR',
    status: PetMembershipStatus = 'ACTIVE',
  ): Promise<MemberFixture> {
    const account = await createAccount();
    const member: MemberFixture = { ...account, membershipId: randomUUID() };
    await database.connection.insert(petMemberships).values({
      id: member.membershipId,
      petId: pet.id.value,
      accountId: member.accountId,
      role,
      status,
      createdAt: ORIGINAL_TIMESTAMP,
      updatedAt: ORIGINAL_TIMESTAMP,
    });
    return member;
  }

  async function rows() {
    return database.connection
      .select()
      .from(petMemberships)
      .where(eq(petMemberships.petId, pet.id.value));
  }

  async function memberRows(member: MemberFixture) {
    return database.connection
      .select()
      .from(petMemberships)
      .where(eq(petMemberships.id, member.membershipId));
  }

  async function activeOwnerIds(): Promise<string[]> {
    return (await rows())
      .filter(
        (membership): boolean =>
          membership.role === 'OWNER' && membership.status === 'ACTIVE',
      )
      .map((membership): string => membership.id);
  }

  async function createInvitation(
    member: MemberFixture,
  ): Promise<PetInvitation> {
    const invitation: PetInvitation = PetInvitation.create({
      petId: pet.id,
      invitedEmail: InvitedEmail.from(member.email),
      invitedByAccountId: AccountId.from(owner.accountId),
      createdAt: new Date(NOW.getTime() - 86_400_000),
    });
    await invitationRepository.createPending(invitation, null);
    return invitation;
  }

  async function blockPet(): Promise<PetBlocker> {
    let release: () => void = (): void => {
      throw new Error('Pet barrier is not initialized');
    };
    let acquired: () => void = (): void => {
      throw new Error('Pet lock signal is not initialized');
    };
    const barrier: Promise<void> = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked: Promise<void> = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let backendId: number = 0;
    const blocker: Promise<void> = database.connection.transaction(
      async (transaction): Promise<void> => {
        const backendRows = await transaction.execute(
          sql`SELECT pg_backend_pid() AS id`,
        );
        backendId = Number(backendRows[0].id);
        await transaction
          .select({ id: pets.id })
          .from(pets)
          .where(eq(pets.id, pet.id.value))
          .for('update');
        acquired();
        await barrier;
      },
    );
    await locked;
    return {
      backendId,
      releaseAndWait: async (): Promise<void> => {
        release();
        await blocker;
      },
    };
  }

  async function waitForPetWaiters(
    backendId: number,
    expected: number,
  ): Promise<void> {
    const deadline: number = Date.now() + 5000;
    while (Date.now() < deadline) {
      // Scope observation to this barrier's blocking chain, including queued waiters.
      const waitingRows = await database.connection.execute(sql`
        WITH RECURSIVE blocked AS (
          SELECT pid FROM pg_stat_activity WHERE ${backendId} = ANY(pg_blocking_pids(pid))
          UNION
          SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
        )
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE pid IN (SELECT pid FROM blocked) AND wait_event_type = 'Lock' AND query ILIKE '%"pets"%'
      `);
      if (Number(waitingRows[0]?.waiting ?? 0) >= expected) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(
      `Expected ${expected} Pet lock waiters for backend ${backendId}`,
    );
  }

  async function runQueued(
    actions: readonly (() => Promise<unknown>)[],
  ): Promise<OperationResult[]> {
    const blocker: PetBlocker = await blockPet();
    const operations: Promise<OperationResult>[] = [];
    try {
      for (const action of actions) {
        operations.push(
          action().then(
            (): OperationResult => ({ outcome: 'SUCCEEDED' }),
            (error: unknown): OperationResult => ({ outcome: 'FAILED', error }),
          ),
        );
        await waitForPetWaiters(blocker.backendId, operations.length);
      }
    } finally {
      await blocker.releaseAndWait();
      await Promise.all(operations);
    }
    return Promise.all(operations);
  }

  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'preserves %s history, updates once, and retries without any physical UPDATE',
    async (role) => {
      const member: MemberFixture = await addMember(role);
      const before = await memberRows(member);
      const petBefore = await database.connection
        .select()
        .from(pets)
        .where(eq(pets.id, pet.id.value));
      await expect(
        leave.execute(pet.id.value, member.accountId),
      ).resolves.toBeUndefined();
      const after = await memberRows(member);
      expect(after[0]).toMatchObject({
        id: member.membershipId,
        accountId: member.accountId,
        role,
        status: 'INACTIVE',
        createdAt: before[0].createdAt,
      });
      expect(after[0].updatedAt.getTime()).toBeGreaterThan(
        before[0].updatedAt.getTime(),
      );
      const physicalBefore = await database.connection.execute(
        sql`SELECT xmin::text AS version, ctid::text AS location FROM pet_memberships WHERE id = ${member.membershipId}`,
      );
      await expect(
        leave.execute(pet.id.value, member.accountId),
      ).resolves.toBeUndefined();
      const physicalAfter = await database.connection.execute(
        sql`SELECT xmin::text AS version, ctid::text AS location FROM pet_memberships WHERE id = ${member.membershipId}`,
      );
      expect(physicalAfter).toEqual(physicalBefore);
      expect(await memberRows(member)).toEqual(after);
      expect(
        await database.connection
          .select()
          .from(pets)
          .where(eq(pets.id, pet.id.value)),
      ).toEqual(petBefore);
    },
  );

  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'allows an initially inactive %s retry without evaluating the last-owner invariant',
    async (role) => {
      const member: MemberFixture = await addMember(role, 'INACTIVE');
      const before = await memberRows(member);
      await expect(
        leave.execute(pet.id.value, member.accountId),
      ).resolves.toBeUndefined();
      expect(await memberRows(member)).toEqual(before);
    },
  );

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'rejects the last owner of an %s pet and preserves all rows',
    async (status) => {
      if (status === 'ARCHIVED')
        await database.connection
          .update(pets)
          .set({ status })
          .where(eq(pets.id, pet.id.value));
      const before = await rows();
      await expect(
        leave.execute(pet.id.value, owner.accountId),
      ).rejects.toThrow(LastOwnerCannotLeaveError);
      expect(await rows()).toEqual(before);
    },
  );

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'allows an owner and a collaborator to leave an %s pet',
    async (status) => {
      const secondOwner: MemberFixture = await addMember('OWNER');
      const collaborator: MemberFixture = await addMember();
      await database.connection
        .update(pets)
        .set({ status })
        .where(eq(pets.id, pet.id.value));
      await leave.execute(pet.id.value, secondOwner.accountId);
      await leave.execute(pet.id.value, collaborator.accountId);
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
      await leave.execute(pet.id.value, secondOwner.accountId);
      await leave.execute(pet.id.value, collaborator.accountId);
      expect(
        (
          await database.connection
            .select()
            .from(pets)
            .where(eq(pets.id, pet.id.value))
        )[0].status,
      ).toBe(status);
    },
  );

  it('leaves two active owners after one of three leaves', async () => {
    const secondOwner: MemberFixture = await addMember('OWNER');
    await addMember('OWNER');
    await leave.execute(pet.id.value, secondOwner.accountId);
    expect(await activeOwnerIds()).toHaveLength(2);
  });

  it('does not count inactive owners, active collaborators, or owners of another pet', async () => {
    await addMember('OWNER', 'INACTIVE');
    await addMember();
    const otherPet: Pet = Pet.register({
      name: 'Other pet',
      species: 'CAT',
      breed: Breed.custom('Mixed'),
      sex: 'UNKNOWN',
      birthInformation: BirthInformation.exact('2020-01-01'),
      ownerAccountId: owner.accountId,
    });
    await new DrizzlePetRepository(database).save(otherPet);
    try {
      await expect(
        leave.execute(pet.id.value, owner.accountId),
      ).rejects.toThrow(LastOwnerCannotLeaveError);
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
    } finally {
      await database.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, otherPet.id.value));
      await database.connection
        .delete(pets)
        .where(eq(pets.id, otherPet.id.value));
    }
  });

  it('hides a nonexistent pet and an absent own membership with the same error', async () => {
    await expect(leave.execute(randomUUID(), owner.accountId)).rejects.toThrow(
      PetNotFoundError,
    );
    await expect(leave.execute(pet.id.value, randomUUID())).rejects.toThrow(
      PetNotFoundError,
    );
  });

  it('excludes a departed owner from current members and revokes their read access', async () => {
    const secondOwner: MemberFixture = await addMember('OWNER');
    await leave.execute(pet.id.value, secondOwner.accountId);
    expect(
      (await listMembers.execute(pet.id.value, owner.accountId)).members.map(
        (member): string => member.membershipId,
      ),
    ).toEqual([owner.membershipId]);
    await expect(
      listMembers.execute(pet.id.value, secondOwner.accountId),
    ).rejects.toThrow(PetNotFoundError);
  });

  it('reactivates a departed owner as a collaborator through a new invitation with the same historical identity', async () => {
    const secondOwner: MemberFixture = await addMember('OWNER');
    await leave.execute(pet.id.value, secondOwner.accountId);
    const before = await memberRows(secondOwner);
    const invitation: PetInvitation = await createInvitation(secondOwner);
    await accept.execute(invitation.id.value, secondOwner.accountId);
    expect((await memberRows(secondOwner))[0]).toMatchObject({
      id: secondOwner.membershipId,
      accountId: secondOwner.accountId,
      role: 'COLLABORATOR',
      status: 'ACTIVE',
      createdAt: before[0].createdAt,
    });
    expect(await activeOwnerIds()).toEqual([owner.membershipId]);
  });

  it.each([2, 3])(
    'serializes %s concurrent owner Leaves and preserves exactly one active owner',
    async (ownerTotal) => {
      const owners: MemberFixture[] = [owner];
      for (let ownerIndex: number = 1; ownerIndex < ownerTotal; ownerIndex += 1)
        owners.push(await addMember('OWNER'));
      const results: OperationResult[] = await runQueued(
        owners.map(
          (member) => (): Promise<void> =>
            leave.execute(pet.id.value, member.accountId),
        ),
      );
      expect(
        results.filter((result): boolean => result.outcome === 'SUCCEEDED'),
      ).toHaveLength(ownerTotal - 1);
      const failures = results.filter((result) => result.outcome === 'FAILED');
      expect(failures).toHaveLength(1);
      expect(failures[0].error).toBeInstanceOf(LastOwnerCannotLeaveError);
      expect(await activeOwnerIds()).toHaveLength(1);
    },
  );

  it('serializes collaborator Leave retries behind Pet and performs one transition', async () => {
    const member: MemberFixture = await addMember();
    expect(
      await runQueued([
        (): Promise<void> => leave.execute(pet.id.value, member.accountId),
        (): Promise<void> => leave.execute(pet.id.value, member.accountId),
      ]),
    ).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
    expect((await memberRows(member))[0].status).toBe('INACTIVE');
  });

  it.each(['promote', 'leave'] as const)(
    'serializes %s first when the sole owner promotes then attempts Leave',
    async (firstAction) => {
      const collaborator: MemberFixture = await addMember();
      const promoteAction = (): Promise<void> =>
        promote.execute({
          petId: pet.id.value,
          requesterAccountId: owner.accountId,
          targetMembershipId: collaborator.membershipId,
        });
      const leaveAction = (): Promise<void> =>
        leave.execute(pet.id.value, owner.accountId);
      const results: OperationResult[] = await runQueued(
        firstAction === 'promote'
          ? [promoteAction, leaveAction]
          : [leaveAction, promoteAction],
      );
      if (firstAction === 'promote') {
        expect(results).toEqual([
          { outcome: 'SUCCEEDED' },
          { outcome: 'SUCCEEDED' },
        ]);
        expect(await activeOwnerIds()).toEqual([collaborator.membershipId]);
      } else {
        expect(results[0].outcome).toBe('FAILED');
        if (results[0].outcome === 'FAILED') {
          expect(results[0].error).toBeInstanceOf(LastOwnerCannotLeaveError);
        }
        expect(results[1].outcome).toBe('SUCCEEDED');
        expect(await activeOwnerIds()).toHaveLength(2);
      }
    },
  );

  it.each(['promote', 'remove'] as const)(
    'rechecks requester authority for %s after an owner Leaves',
    async (action) => {
      const secondOwner: MemberFixture = await addMember('OWNER');
      const collaborator: MemberFixture = await addMember();
      const administrativeAction = (): Promise<void> => {
        const command = {
          petId: pet.id.value,
          requesterAccountId: secondOwner.accountId,
          targetMembershipId: collaborator.membershipId,
        };
        return action === 'promote'
          ? promote.execute(command)
          : remove.execute(command);
      };
      const results: OperationResult[] = await runQueued([
        (): Promise<void> => leave.execute(pet.id.value, secondOwner.accountId),
        administrativeAction,
      ]);
      expect(results[0].outcome).toBe('SUCCEEDED');
      expect(results[1].outcome).toBe('FAILED');
      if (results[1].outcome === 'FAILED') {
        expect(results[1].error).toBeInstanceOf(PetNotFoundError);
      }
      expect((await memberRows(collaborator))[0]).toMatchObject({
        role: 'COLLABORATOR',
        status: 'ACTIVE',
      });
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
    },
  );

  it.each(['leave', 'remove'] as const)(
    'serializes %s first against Remove Collaborator without deadlock',
    async (firstAction) => {
      const secondOwner: MemberFixture = await addMember('OWNER');
      const collaborator: MemberFixture = await addMember();
      const leaveAction = (): Promise<void> =>
        leave.execute(pet.id.value, secondOwner.accountId);
      const removeAction = (): Promise<void> =>
        remove.execute({
          petId: pet.id.value,
          requesterAccountId: owner.accountId,
          targetMembershipId: collaborator.membershipId,
        });
      expect(
        await runQueued(
          firstAction === 'leave'
            ? [leaveAction, removeAction]
            : [removeAction, leaveAction],
        ),
      ).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
      expect((await memberRows(collaborator))[0].status).toBe('INACTIVE');
    },
  );

  it.each(['leave', 'accept'] as const)(
    'serializes %s first against Accept on the leaving owner without deadlock',
    async (firstAction) => {
      const secondOwner: MemberFixture = await addMember('OWNER');
      const invitation: PetInvitation = await createInvitation(secondOwner);
      const leaveAction = (): Promise<void> =>
        leave.execute(pet.id.value, secondOwner.accountId);
      const acceptAction = () =>
        accept.execute(invitation.id.value, secondOwner.accountId);
      expect(
        await runQueued(
          firstAction === 'leave'
            ? [leaveAction, acceptAction]
            : [acceptAction, leaveAction],
        ),
      ).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
      expect((await memberRows(secondOwner))[0]).toMatchObject({
        id: secondOwner.membershipId,
        role: firstAction === 'leave' ? 'COLLABORATOR' : 'OWNER',
        status: firstAction === 'leave' ? 'ACTIVE' : 'INACTIVE',
      });
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
      expect(
        (
          await database.connection
            .select()
            .from(petInvitations)
            .where(eq(petInvitations.id, invitation.id.value))
        )[0].status,
      ).toBe('ACCEPTED');
    },
  );

  it.each(['leave', 'accept'] as const)(
    'preserves collaborator Leave versus Accept ordering with %s first',
    async (firstAction) => {
      const member: MemberFixture = await addMember(
        'COLLABORATOR',
        firstAction === 'leave' ? 'ACTIVE' : 'INACTIVE',
      );
      const invitation: PetInvitation = await createInvitation(member);
      const leaveAction = (): Promise<void> =>
        leave.execute(pet.id.value, member.accountId);
      const acceptAction = () =>
        accept.execute(invitation.id.value, member.accountId);
      expect(
        await runQueued(
          firstAction === 'leave'
            ? [leaveAction, acceptAction]
            : [acceptAction, leaveAction],
        ),
      ).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
      expect((await memberRows(member))[0]).toMatchObject({
        role: 'COLLABORATOR',
        status: firstAction === 'leave' ? 'ACTIVE' : 'INACTIVE',
      });
    },
  );
});
