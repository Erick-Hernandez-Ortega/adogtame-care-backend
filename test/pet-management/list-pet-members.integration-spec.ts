import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import {
  ListPetMembers,
  type PetMember,
} from '../../src/pet-management/application/list-pet-members/list-pet-members';
import { DrizzlePetQueryRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet-query.repository';
import {
  petInvitations,
  petMemberships,
  pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

describe('ListPetMembers with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let listPetMembers: ListPetMembers;
  let reader: DrizzlePetQueryRepository;
  let petId: string;
  let otherPetId: string;
  let accountIds: string[];
  let expectedMembers: PetMember[];

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = fixture;
    database = application.get(DatabaseService);
    listPetMembers = application.get(ListPetMembers);
    reader = application.get(DrizzlePetQueryRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    petId = randomUUID();
    otherPetId = randomUUID();
    accountIds = Array.from({ length: 9 }, (): string => randomUUID());
    const ownerMembershipIds: string[] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ].sort();
    const collaboratorMembershipIds: string[] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ].sort();
    expectedMembers = [
      {
        membershipId: ownerMembershipIds[2],
        accountId: accountIds[0],
        email: `z-owner-${accountIds[0]}@example.com`,
        role: 'OWNER',
      },
      {
        membershipId: ownerMembershipIds[0],
        accountId: accountIds[1],
        email: `a-owner-${accountIds[1]}@example.com`,
        role: 'OWNER',
      },
      {
        membershipId: ownerMembershipIds[1],
        accountId: accountIds[2],
        email: `b-owner-${accountIds[2]}@example.com`,
        role: 'OWNER',
      },
      {
        membershipId: collaboratorMembershipIds[2],
        accountId: accountIds[3],
        email: `z-collaborator-${accountIds[3]}@example.com`,
        role: 'COLLABORATOR',
      },
      {
        membershipId: collaboratorMembershipIds[0],
        accountId: accountIds[4],
        email: `a-collaborator-${accountIds[4]}@example.com`,
        role: 'COLLABORATOR',
      },
      {
        membershipId: collaboratorMembershipIds[1],
        accountId: accountIds[5],
        email: `b-collaborator-${accountIds[5]}@example.com`,
        role: 'COLLABORATOR',
      },
    ];
    await database.connection.insert(accounts).values(
      accountIds.map((accountId: string, index: number) => ({
        id: accountId,
        email: expectedMembers[index]?.email ?? `${accountId}@example.com`,
        passwordHash: 'test-password-hash',
      })),
    );
    await database.connection.insert(pets).values(
      [petId, otherPetId].map((id: string) => ({
        id,
        name: 'Members pet',
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
      ...expectedMembers
        .slice()
        .reverse()
        .map((member: PetMember) => ({
          id: member.membershipId,
          petId,
          accountId: member.accountId,
          role: member.role,
          status: 'ACTIVE',
        })),
      {
        id: randomUUID(),
        petId,
        accountId: accountIds[6],
        role: 'OWNER',
        status: 'INACTIVE',
      },
      {
        id: randomUUID(),
        petId,
        accountId: accountIds[7],
        role: 'COLLABORATOR',
        status: 'INACTIVE',
      },
      {
        id: randomUUID(),
        petId: otherPetId,
        accountId: accountIds[8],
        role: 'OWNER',
        status: 'ACTIVE',
      },
    ]);
    const createdDates: string[] = [
      '2026-09-26T12:00:00.123456Z',
      '2026-09-26T12:00:00.123457Z',
      '2026-09-26T12:00:00.123457Z',
      '2026-09-25T12:00:00.123456Z',
      '2026-09-25T12:00:00.123457Z',
      '2026-09-25T12:00:00.123457Z',
    ];
    for (const [index, member] of expectedMembers.entries()) {
      await database.connection.execute(
        sql`UPDATE pet_memberships SET created_at = ${createdDates[index]}::timestamptz WHERE id = ${member.membershipId}::uuid`,
      );
    }
    await database.connection.insert(petInvitations).values({
      id: randomUUID(),
      petId,
      invitedEmail: `${accountIds[8]}@example.com`,
      invitedByAccountId: accountIds[6],
      status: 'PENDING',
      createdAt: new Date('2026-10-01T12:00:00Z'),
      expiresAt: new Date('2026-10-08T12:00:00Z'),
    });
  });

  afterEach(async () => {
    await database.connection
      .delete(petInvitations)
      .where(eq(petInvitations.petId, petId));
    await database.connection
      .delete(petMemberships)
      .where(inArray(petMemberships.petId, [petId, otherPetId]));
    await database.connection
      .delete(pets)
      .where(inArray(pets.id, [petId, otherPetId]));
    await database.connection
      .delete(accounts)
      .where(inArray(accounts.id, accountIds));
  });

  it.each([
    { status: 'ACTIVE', requesterIndex: 0, role: 'OWNER' },
    { status: 'ACTIVE', requesterIndex: 3, role: 'COLLABORATOR' },
    { status: 'ARCHIVED', requesterIndex: 0, role: 'OWNER' },
    { status: 'ARCHIVED', requesterIndex: 3, role: 'COLLABORATOR' },
  ] as const)(
    'lists current members of an $status pet for an active $role',
    async ({ status, requesterIndex }): Promise<void> => {
      await database.connection
        .update(pets)
        .set({ status })
        .where(eq(pets.id, petId));
      await expect(
        listPetMembers.execute(petId, accountIds[requesterIndex]),
      ).resolves.toEqual({ members: expectedMembers });
      await expect(
        reader.findAccessibleMembers(petId, accountIds[requesterIndex]),
      ).resolves.toEqual(
        expectedMembers.map((member: PetMember) => ({
          membershipId: member.membershipId,
          accountId: member.accountId,
          role: member.role,
        })),
      );
    },
  );

  it.each(['ACTIVE', 'ARCHIVED'] as const)(
    'hides an %s pet from inactive members, invitation authors, invitees, and members of another pet',
    async (status) => {
      await database.connection
        .update(pets)
        .set({ status })
        .where(eq(pets.id, petId));
      for (const accountId of accountIds.slice(6)) {
        await expect(
          reader.findAccessibleMembers(petId, accountId),
        ).resolves.toBeNull();
        await expect(listPetMembers.execute(petId, accountId)).rejects.toThrow(
          PetNotFoundError,
        );
      }
      await expect(
        listPetMembers.execute(randomUUID(), accountIds[0]),
      ).rejects.toThrow(PetNotFoundError);
    },
  );

  it('returns the requester as the only member when no other active memberships remain', async () => {
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(inArray(petMemberships.accountId, accountIds.slice(1, 6)));
    await expect(listPetMembers.execute(petId, accountIds[0])).resolves.toEqual(
      { members: [expectedMembers[0]] },
    );
  });

  it('fails on an orphaned membership without returning a partial response', async () => {
    await database.connection
      .delete(accounts)
      .where(eq(accounts.id, accountIds[1]));
    await expect(listPetMembers.execute(petId, accountIds[0])).rejects.toThrow(
      'Pet membership references a missing account',
    );
  });
});
