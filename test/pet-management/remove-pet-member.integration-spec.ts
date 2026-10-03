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
import {
  PetMemberInactiveError,
  PromoteCollaboratorToOwner,
} from '../../src/pet-management/application/promote-collaborator-to-owner/promote-collaborator-to-owner';
import {
  SelfRemovalNotSupportedError,
  RemovePetMember,
  PetMemberNotFoundError,
} from '../../src/pet-management/application/remove-pet-member/remove-pet-member';
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

describe('RemovePetMember with PostgreSQL (integration)', () => {
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
    const email: string = `remove-member-${accountId}@example.com`;
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
      name: 'Remove member pet',
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

  function removeTarget(
    target: MemberFixture,
    requester: MemberFixture = owner,
    petId: string = pet.id.value,
  ): Promise<void> {
    return remove.execute({
      requesterAccountId: requester.accountId,
      targetMembershipId: target.membershipId,
      petId,
    });
  }

  async function physicalRow(member: MemberFixture) {
    return database.connection.execute(
      sql`SELECT xmin::text AS version, ctid::text AS location FROM pet_memberships WHERE id = ${member.membershipId}`,
    );
  }

  async function withoutRedundantUpdates<T>(
    action: () => Promise<T>,
  ): Promise<T> {
    // Test-only guard detects physical UPDATEs on already inactive targets.
    await database.connection.execute(sql`
      CREATE FUNCTION test_remove_member_reject_redundant_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Redundant inactive membership UPDATE';
      END;
      $$ LANGUAGE plpgsql
    `);
    try {
      await database.connection.execute(
        sql.raw(
          `CREATE TRIGGER test_remove_member_no_redundant_update BEFORE UPDATE ON pet_memberships
         FOR EACH ROW WHEN (OLD.pet_id = '${pet.id.value}'::uuid AND OLD.status = 'INACTIVE' AND NEW.status = 'INACTIVE')
         EXECUTE FUNCTION test_remove_member_reject_redundant_update()`,
        ),
      );
      try {
        return await action();
      } finally {
        await database.connection.execute(
          sql`DROP TRIGGER test_remove_member_no_redundant_update ON pet_memberships`,
        );
      }
    } finally {
      await database.connection.execute(
        sql`DROP FUNCTION test_remove_member_reject_redundant_update()`,
      );
    }
  }

  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'removes an active %s preserving history and retries without a physical UPDATE',
    async (role) => {
      const target: MemberFixture = await addMember(role);
      const before = await memberRows(target);
      const petBefore = await database.connection
        .select()
        .from(pets)
        .where(eq(pets.id, pet.id.value));
      const invitation: PetInvitation = await createInvitation(target);
      const invitationBefore = await database.connection
        .select()
        .from(petInvitations)
        .where(eq(petInvitations.id, invitation.id.value));
      await withoutRedundantUpdates(async (): Promise<void> => {
        await removeTarget(target);
        const after = await memberRows(target);
        expect(after[0]).toMatchObject({
          id: target.membershipId,
          accountId: target.accountId,
          petId: pet.id.value,
          role,
          status: 'INACTIVE',
          createdAt: before[0].createdAt,
        });
        expect(after[0].updatedAt.getTime()).toBeGreaterThan(
          before[0].updatedAt.getTime(),
        );
        const physicalBefore = await physicalRow(target);
        await removeTarget(target);
        expect(await memberRows(target)).toEqual(after);
        expect(await physicalRow(target)).toEqual(physicalBefore);
      });
      expect(
        (await listMembers.execute(pet.id.value, owner.accountId)).members.map(
          (member): string => member.membershipId,
        ),
      ).not.toContain(target.membershipId);
      await expect(
        listMembers.execute(pet.id.value, target.accountId),
      ).rejects.toThrow(PetNotFoundError);
      expect(
        await database.connection
          .select()
          .from(pets)
          .where(eq(pets.id, pet.id.value)),
      ).toEqual(petBefore);
      expect(
        await database.connection
          .select()
          .from(petInvitations)
          .where(eq(petInvitations.id, invitation.id.value)),
      ).toEqual(invitationBefore);
      await accept.execute(invitation.id.value, target.accountId);
      expect((await memberRows(target))[0]).toMatchObject({
        id: target.membershipId,
        accountId: target.accountId,
        role: 'COLLABORATOR',
        status: 'ACTIVE',
        createdAt: before[0].createdAt,
      });
    },
  );

  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'accepts another inactive %s without any UPDATE',
    async (role) => {
      const target: MemberFixture = await addMember(role, 'INACTIVE');
      const before = await memberRows(target);
      const physicalBefore = await physicalRow(target);
      await withoutRedundantUpdates(() => removeTarget(target));
      expect(await memberRows(target)).toEqual(before);
      expect(await physicalRow(target)).toEqual(physicalBefore);
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
    },
  );

  it.each([
    ['COLLABORATOR', 'ACTIVE'],
    ['COLLABORATOR', 'INACTIVE'],
    ['OWNER', 'INACTIVE'],
  ] as const)(
    'hides a %s %s requester before target existence, self-target, or idempotence',
    async (role, status) => {
      const requester: MemberFixture = await addMember(role, status);
      const target: MemberFixture = await addMember('OWNER', 'INACTIVE');
      const before = await rows();
      for (const selected of [
        target,
        requester,
        { ...target, membershipId: randomUUID() },
      ]) {
        await expect(removeTarget(selected, requester)).rejects.toThrow(
          PetNotFoundError,
        );
      }
      expect(await rows()).toEqual(before);
    },
  );

  it.each(['missing pet', 'archived pet', 'no membership'] as const)(
    'hides %s before target resolution',
    async (scenario) => {
      const target: MemberFixture = await addMember('OWNER', 'INACTIVE');
      let requestedPetId: string = pet.id.value;
      let requester: MemberFixture = owner;
      if (scenario === 'missing pet') requestedPetId = randomUUID();
      if (scenario === 'archived pet')
        await database.connection
          .update(pets)
          .set({ status: 'ARCHIVED' })
          .where(eq(pets.id, pet.id.value));
      if (scenario === 'no membership')
        requester = { ...owner, accountId: randomUUID() };
      const before = await rows();
      for (const selected of [
        target,
        owner,
        { ...target, membershipId: randomUUID() },
      ]) {
        await expect(
          removeTarget(selected, requester, requestedPetId),
        ).rejects.toThrow(PetNotFoundError);
      }
      expect(await rows()).toEqual(before);
    },
  );

  it('resolves targets only by Pet and membership identity after authorization', async () => {
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
      for (const membershipId of [
        randomUUID(),
        otherPet.memberships[0].id.value,
      ]) {
        await expect(removeTarget({ ...owner, membershipId })).rejects.toThrow(
          PetMemberNotFoundError,
        );
      }
    } finally {
      await database.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, otherPet.id.value));
      await database.connection
        .delete(pets)
        .where(eq(pets.id, otherPet.id.value));
    }
  });

  it.each([1, 2])(
    'rejects self-removal with %s active owners without an UPDATE',
    async (ownerTotal) => {
      if (ownerTotal === 2) await addMember('OWNER');
      const before = await rows();
      const physicalBefore = await physicalRow(owner);
      await expect(
        removeTarget({
          ...owner,
          membershipId: owner.membershipId.toUpperCase(),
        }),
      ).rejects.toThrow(SelfRemovalNotSupportedError);
      expect(await rows()).toEqual(before);
      expect(await physicalRow(owner)).toEqual(physicalBefore);
      expect(await activeOwnerIds()).toHaveLength(ownerTotal);
    },
  );

  it('rechecks requester authority on retry after another owner removes the requester', async () => {
    const target: MemberFixture = await addMember();
    const otherOwner: MemberFixture = await addMember('OWNER');
    await removeTarget(target);
    await removeTarget(owner, otherOwner);
    const before = await memberRows(target);
    await expect(removeTarget(target)).rejects.toThrow(PetNotFoundError);
    expect(await memberRows(target)).toEqual(before);
  });

  it('serializes two requesters removing the same owner with one physical transition', async () => {
    const target: MemberFixture = await addMember('OWNER');
    const otherOwner: MemberFixture = await addMember('OWNER');
    await withoutRedundantUpdates(async (): Promise<void> => {
      expect(
        await runQueued([
          () => removeTarget(target),
          () => removeTarget(target, otherOwner),
        ]),
      ).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
    });
    expect((await memberRows(target))[0]).toMatchObject({
      role: 'OWNER',
      status: 'INACTIVE',
    });
    expect(await activeOwnerIds()).toHaveLength(2);
  });

  it.each(['original owner', 'second owner'] as const)(
    'serializes cross-removal with %s first and revalidates the loser',
    async (firstRequester) => {
      const secondOwner: MemberFixture = await addMember('OWNER');
      const first: MemberFixture =
        firstRequester === 'original owner' ? owner : secondOwner;
      const second: MemberFixture =
        firstRequester === 'original owner' ? secondOwner : owner;
      const results: OperationResult[] = await withoutRedundantUpdates(() =>
        runQueued([
          () => removeTarget(second, first),
          () => removeTarget(first, second),
        ]),
      );
      expect(results[0]).toEqual({ outcome: 'SUCCEEDED' });
      expect(results[1].outcome).toBe('FAILED');
      if (results[1].outcome === 'FAILED')
        expect(results[1].error).toBeInstanceOf(PetNotFoundError);
      expect(await activeOwnerIds()).toEqual([first.membershipId]);
      expect((await memberRows(second))[0].status).toBe('INACTIVE');
    },
  );

  it.each([
    [2, 'remove', 'OWNER'],
    [2, 'leave', 'OWNER'],
    [3, 'remove', 'OWNER'],
    [3, 'leave', 'OWNER'],
    [2, 'remove', 'COLLABORATOR'],
    [2, 'leave', 'COLLABORATOR'],
  ] as const)(
    'serializes %s-owner Remove versus Leave with %s first on %s and no redundant UPDATE',
    async (ownerTotal, firstAction, targetRole) => {
      const target: MemberFixture = await addMember(targetRole);
      if (targetRole === 'COLLABORATOR') await addMember('OWNER');
      if (ownerTotal === 3) await addMember('OWNER');
      const removeAction = (): Promise<void> => removeTarget(target);
      const leaveAction = (): Promise<void> =>
        leave.execute(pet.id.value, target.accountId);
      const results: OperationResult[] = await withoutRedundantUpdates(() =>
        runQueued(
          firstAction === 'remove'
            ? [removeAction, leaveAction]
            : [leaveAction, removeAction],
        ),
      );
      expect(results).toEqual([
        { outcome: 'SUCCEEDED' },
        { outcome: 'SUCCEEDED' },
      ]);
      expect((await memberRows(target))[0]).toMatchObject({
        role: targetRole,
        status: 'INACTIVE',
      });
      expect(await activeOwnerIds()).toHaveLength(
        targetRole === 'OWNER' ? ownerTotal - 1 : ownerTotal,
      );
    },
  );

  it('serializes Remove and two owner Leaves, preserving the final active owner', async () => {
    const target: MemberFixture = await addMember('OWNER');
    const otherOwner: MemberFixture = await addMember('OWNER');
    const results: OperationResult[] = await withoutRedundantUpdates(() =>
      runQueued([
        () => removeTarget(target),
        () => leave.execute(pet.id.value, otherOwner.accountId),
        () => leave.execute(pet.id.value, owner.accountId),
      ]),
    );
    expect(results[0]).toEqual({ outcome: 'SUCCEEDED' });
    expect(results[1]).toEqual({ outcome: 'SUCCEEDED' });
    expect(results[2].outcome).toBe('FAILED');
    if (results[2].outcome === 'FAILED')
      expect(results[2].error).toBeInstanceOf(LastOwnerCannotLeaveError);
    expect(await activeOwnerIds()).toEqual([owner.membershipId]);
  });

  it('revalidates Remove authority after its requester Leaves first', async () => {
    const otherOwner: MemberFixture = await addMember('OWNER');
    const target: MemberFixture = await addMember();
    const results: OperationResult[] = await runQueued([
      () => leave.execute(pet.id.value, owner.accountId),
      () => removeTarget(target),
    ]);
    expect(results[0]).toEqual({ outcome: 'SUCCEEDED' });
    if (results[1].outcome !== 'FAILED')
      throw new Error('Expected requester authorization failure');
    expect(results[1].error).toBeInstanceOf(PetNotFoundError);
    expect((await memberRows(target))[0].status).toBe('ACTIVE');
    expect(await activeOwnerIds()).toEqual([otherOwner.membershipId]);
  });

  it.each(['remove', 'promote'] as const)(
    'serializes %s first when removing the Promote requester',
    async (firstAction) => {
      const targetOwner: MemberFixture = await addMember('OWNER');
      const collaborator: MemberFixture = await addMember();
      const removeAction = (): Promise<void> => removeTarget(targetOwner);
      const promoteAction = (): Promise<void> =>
        promote.execute({
          petId: pet.id.value,
          requesterAccountId: targetOwner.accountId,
          targetMembershipId: collaborator.membershipId,
        });
      const results: OperationResult[] = await runQueued(
        firstAction === 'remove'
          ? [removeAction, promoteAction]
          : [promoteAction, removeAction],
      );
      expect(results[0]).toEqual({ outcome: 'SUCCEEDED' });
      if (firstAction === 'remove') {
        if (results[1].outcome !== 'FAILED')
          throw new Error('Expected requester authorization failure');
        expect(results[1].error).toBeInstanceOf(PetNotFoundError);
      } else expect(results[1]).toEqual({ outcome: 'SUCCEEDED' });
      expect((await memberRows(collaborator))[0].role).toBe(
        firstAction === 'remove' ? 'COLLABORATOR' : 'OWNER',
      );
      expect(await activeOwnerIds()).toHaveLength(
        firstAction === 'remove' ? 1 : 2,
      );
    },
  );

  it.each(['remove', 'promote'] as const)(
    'observes the current target role with %s first against Promote',
    async (firstAction) => {
      const target: MemberFixture = await addMember();
      const removeAction = (): Promise<void> => removeTarget(target);
      const promoteAction = (): Promise<void> =>
        promote.execute({
          petId: pet.id.value,
          requesterAccountId: owner.accountId,
          targetMembershipId: target.membershipId,
        });
      const results: OperationResult[] = await runQueued(
        firstAction === 'remove'
          ? [removeAction, promoteAction]
          : [promoteAction, removeAction],
      );
      expect(results[0]).toEqual({ outcome: 'SUCCEEDED' });
      if (firstAction === 'remove') {
        if (results[1].outcome !== 'FAILED')
          throw new Error('Expected inactive target failure');
        expect(results[1].error).toBeInstanceOf(PetMemberInactiveError);
      } else expect(results[1]).toEqual({ outcome: 'SUCCEEDED' });
      expect((await memberRows(target))[0]).toMatchObject({
        role: firstAction === 'remove' ? 'COLLABORATOR' : 'OWNER',
        status: 'INACTIVE',
      });
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
    },
  );

  it.each([
    ['remove', 'OWNER'],
    ['accept', 'OWNER'],
    ['remove', 'COLLABORATOR'],
    ['accept', 'COLLABORATOR'],
  ] as const)(
    'serializes %s first against Accept on a %s without deadlock or lost update',
    async (firstAction, targetRole) => {
      const target: MemberFixture = await addMember(
        targetRole,
        targetRole === 'COLLABORATOR' && firstAction === 'accept'
          ? 'INACTIVE'
          : 'ACTIVE',
      );
      const invitation: PetInvitation = await createInvitation(target);
      const removeAction = (): Promise<void> => removeTarget(target);
      const acceptAction = () =>
        accept.execute(invitation.id.value, target.accountId);
      expect(
        await runQueued(
          firstAction === 'remove'
            ? [removeAction, acceptAction]
            : [acceptAction, removeAction],
        ),
      ).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
      expect((await memberRows(target))[0]).toMatchObject({
        id: target.membershipId,
        accountId: target.accountId,
        role: firstAction === 'remove' ? 'COLLABORATOR' : targetRole,
        status: firstAction === 'remove' ? 'ACTIVE' : 'INACTIVE',
        createdAt: ORIGINAL_TIMESTAMP,
      });
      expect(await activeOwnerIds()).toEqual([owner.membershipId]);
      const before = await memberRows(target);
      await accept.execute(invitation.id.value, target.accountId);
      expect(await memberRows(target)).toEqual(before);
    },
  );

  it('serializes removal of different roles on the same Pet', async () => {
    const targetOwner: MemberFixture = await addMember('OWNER');
    const collaborator: MemberFixture = await addMember();
    expect(
      await runQueued([
        () => removeTarget(targetOwner),
        () => removeTarget(collaborator),
      ]),
    ).toEqual([{ outcome: 'SUCCEEDED' }, { outcome: 'SUCCEEDED' }]);
    expect((await memberRows(targetOwner))[0].status).toBe('INACTIVE');
    expect((await memberRows(collaborator))[0].status).toBe('INACTIVE');
    expect(await activeOwnerIds()).toEqual([owner.membershipId]);
  });

  it('rechecks Pet status after waiting for a preceding archive', async () => {
    const target: MemberFixture = await addMember('OWNER');
    const before = await memberRows(target);
    const results: OperationResult[] = await runQueued([
      async (): Promise<void> => {
        await database.connection
          .update(pets)
          .set({ status: 'ARCHIVED' })
          .where(eq(pets.id, pet.id.value));
      },
      () => removeTarget(target),
    ]);
    expect(results[0]).toEqual({ outcome: 'SUCCEEDED' });
    if (results[1].outcome !== 'FAILED')
      throw new Error('Expected archived Pet failure');
    expect(results[1].error).toBeInstanceOf(PetNotFoundError);
    expect(await memberRows(target)).toEqual(before);
  });
});
