import {
  PetMemberRemovalPolicy,
  type PetMemberRemovalDecision,
} from '../../../domain/pet/pet-member-removal.policy';
import { Injectable } from '@nestjs/common';
import { and, eq, exists, ne } from 'drizzle-orm';
import {
  PetLeavePolicy,
  type PetLeaveDecision,
} from '../../../domain/pet/pet-leave.policy';
import type {
  LeavePetPersistenceResult,
  RemovePetMemberPersistenceResult,
  RemovePetMemberCommand,
  PetRepository,
  PromoteCollaboratorCommand,
  PromoteCollaboratorPersistenceResult,
} from '../../../application/persistence/pet.repository';
import { BirthInformation } from '../../../domain/birth-information/birth-information';
import { Breed } from '../../../domain/breed/breed';
import {
  AccountId,
  InactivePetMembershipError,
  MembershipId,
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from '../../../domain/pet-membership/pet-membership';
import type {
  PetMembershipRole as PetMembershipRoleType,
  PetMembershipStatus as PetMembershipStatusType,
} from '../../../domain/pet-membership/pet-membership.types';
import { Pet, PetId, PetStatus } from '../../../domain/pet/pet';
import type { PetSex, PetSpecies } from '../../../domain/pet/pet.types';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import { petMemberships, pets } from './pet-management.schema';

@Injectable()
export class DrizzlePetRepository implements PetRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async promoteCollaboratorIfOwned(
    command: PromoteCollaboratorCommand,
  ): Promise<PromoteCollaboratorPersistenceResult> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<PromoteCollaboratorPersistenceResult> => {
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, command.petId))
          .for('update');
        if (petRows[0]?.status !== PetStatus.ACTIVE)
          return { outcome: 'PET_NOT_FOUND' };

        const requesterRows = await transaction
          .select()
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, command.petId),
              eq(petMemberships.accountId, command.requesterAccountId),
            ),
          )
          .for('update');
        const requester = requesterRows[0];
        if (
          requester?.status !== PetMembershipStatus.ACTIVE ||
          requester.role !== PetMembershipRole.OWNER
        ) {
          return { outcome: 'PET_NOT_FOUND' };
        }

        if (requester.id === command.targetMembershipId.toLowerCase()) {
          return { outcome: 'ALREADY_OWNER' };
        }

        const targetRows = await transaction
          .select()
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, command.petId),
              eq(petMemberships.id, command.targetMembershipId),
            ),
          )
          .for('update');
        const target = targetRows[0];
        if (target === undefined) return { outcome: 'PET_MEMBER_NOT_FOUND' };

        const membership: PetMembership = PetMembership.reconstitute({
          id: MembershipId.from(target.id),
          accountId: AccountId.from(target.accountId),
          role: target.role as PetMembershipRoleType,
          status: target.status as PetMembershipStatusType,
        });
        let promoted: PetMembership;
        try {
          promoted = membership.promoteToOwner();
        } catch (error: unknown) {
          if (error instanceof InactivePetMembershipError) {
            return { outcome: 'PET_MEMBER_INACTIVE' };
          }
          throw error;
        }
        if (promoted === membership) return { outcome: 'ALREADY_OWNER' };

        const changedRows = await transaction
          .update(petMemberships)
          .set({ role: promoted.role })
          .where(
            and(
              eq(petMemberships.id, target.id),
              eq(petMemberships.petId, command.petId),
              eq(petMemberships.accountId, target.accountId),
              eq(petMemberships.role, PetMembershipRole.COLLABORATOR),
              eq(petMemberships.status, PetMembershipStatus.ACTIVE),
            ),
          )
          .returning({ id: petMemberships.id });
        if (changedRows.length !== 1) {
          throw new Error('Membership transition did not update one row');
        }
        return { outcome: 'PROMOTED' };
      },
      { isolationLevel: 'read committed' },
    );
  }

  async correctProfileIfOwned(
    petId: string,
    authenticatedAccountId: string,
    correct: (pet: Pet) => Pet,
  ): Promise<Pet | null> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<Pet | null> => {
        const petRows = await transaction
          .select()
          .from(pets)
          .where(eq(pets.id, petId))
          .for('update');
        const petRow = petRows[0];
        if (petRow?.status !== PetStatus.ACTIVE) return null;

        const requesterRows = await transaction
          .select({ role: petMemberships.role, status: petMemberships.status })
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, petId),
              eq(petMemberships.accountId, authenticatedAccountId),
            ),
          )
          .for('update');
        if (
          requesterRows[0]?.status !== PetMembershipStatus.ACTIVE ||
          requesterRows[0]?.role !== PetMembershipRole.OWNER
        ) {
          return null;
        }

        const membershipRows = await transaction
          .select()
          .from(petMemberships)
          .where(eq(petMemberships.petId, petId));
        const memberships: PetMembership[] = membershipRows.map((row) =>
          PetMembership.reconstitute({
            id: MembershipId.from(row.id),
            accountId: AccountId.from(row.accountId),
            role: row.role as PetMembershipRoleType,
            status: row.status as PetMembershipStatusType,
          }),
        );
        const breed: Breed =
          petRow.breedKind === 'KNOWN'
            ? Breed.known(petRow.breedName)
            : Breed.custom(petRow.breedName);
        const birthInformation: BirthInformation =
          petRow.birthDateAccuracy === 'EXACT'
            ? BirthInformation.exact(petRow.birthDate)
            : BirthInformation.approximate(petRow.birthDate);
        const pet: Pet = Pet.reconstitute({
          id: PetId.from(petRow.id),
          name: petRow.name,
          species: petRow.species as PetSpecies,
          breed,
          sex: petRow.sex as PetSex,
          birthInformation,
          color: petRow.color ?? undefined,
          distinctiveMarks: petRow.distinctiveMarks ?? undefined,
          microchip: petRow.microchip ?? undefined,
          status: PetStatus.ACTIVE,
          memberships,
        });
        const corrected: Pet = correct(pet);
        if (corrected === pet) return pet;

        await transaction
          .update(pets)
          .set({
            name: corrected.name,
            species: corrected.species,
            breedName: corrected.breed.name,
            breedKind: corrected.breed.kind,
            sex: corrected.sex,
            birthDate: corrected.birthInformation.date,
            birthDateAccuracy: corrected.birthInformation.accuracy,
            color: corrected.color ?? null,
            distinctiveMarks: corrected.distinctiveMarks ?? null,
            microchip: corrected.microchip ?? null,
          })
          .where(eq(pets.id, petId));
        return corrected;
      },
      { isolationLevel: 'read committed' },
    );
  }

  async leave(
    petId: string,
    authenticatedAccountId: string,
  ): Promise<LeavePetPersistenceResult> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<LeavePetPersistenceResult> => {
        // Pet is the aggregate mutex; acquire it first (see docs/pet-leave.md).
        const petRows = await transaction
          .select({ id: pets.id })
          .from(pets)
          .where(eq(pets.id, petId))
          .for('update');
        if (petRows[0] === undefined) return { outcome: 'PET_NOT_FOUND' };

        const membershipRows = await transaction
          .select()
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, petId),
              eq(petMemberships.accountId, authenticatedAccountId),
            ),
          )
          .for('update');
        const row = membershipRows[0];
        if (row === undefined) {
          return { outcome: 'PET_NOT_FOUND' };
        }

        const membership: PetMembership = PetMembership.reconstitute({
          id: MembershipId.from(row.id),
          accountId: AccountId.from(row.accountId),
          role: row.role as PetMembershipRoleType,
          status: row.status as PetMembershipStatusType,
        });
        let hasAnotherActiveOwner: boolean = false;
        if (
          membership.status === PetMembershipStatus.ACTIVE &&
          membership.role === PetMembershipRole.OWNER
        ) {
          const otherOwnerRows = await transaction
            .select({
              hasAnotherActiveOwner: exists(
                transaction
                  .select({ id: petMemberships.id })
                  .from(petMemberships)
                  .where(
                    and(
                      eq(petMemberships.petId, petId),
                      eq(petMemberships.role, PetMembershipRole.OWNER),
                      eq(petMemberships.status, PetMembershipStatus.ACTIVE),
                      ne(petMemberships.id, row.id),
                    ),
                  ),
              ),
            })
            .from(pets)
            .where(eq(pets.id, petId));
          hasAnotherActiveOwner =
            otherOwnerRows[0]?.hasAnotherActiveOwner === true;
        }
        const decision: PetLeaveDecision = PetLeavePolicy.decide(
          membership,
          hasAnotherActiveOwner,
        );

        if (decision.membershipToSave !== null) {
          const changedRows = await transaction
            .update(petMemberships)
            .set({ status: decision.membershipToSave.status })
            .where(
              and(
                eq(petMemberships.id, row.id),
                eq(petMemberships.petId, petId),
                eq(petMemberships.accountId, authenticatedAccountId),
                eq(petMemberships.role, membership.role),
                eq(petMemberships.status, PetMembershipStatus.ACTIVE),
              ),
            )
            .returning({ id: petMemberships.id });
          if (changedRows.length !== 1) {
            throw new Error('Membership transition did not update one row');
          }
        }

        return { outcome: decision.outcome };
      },
      { isolationLevel: 'read committed' },
    );
  }

  async removeMemberIfOwned(
    command: RemovePetMemberCommand,
  ): Promise<RemovePetMemberPersistenceResult> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<RemovePetMemberPersistenceResult> => {
        // Pet is the owner-set mutex; acquire it first (see docs/pet-member-removal.md).
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, command.petId))
          .for('update');
        if (petRows[0]?.status !== PetStatus.ACTIVE)
          return { outcome: 'PET_NOT_FOUND' };

        const requesterRows = await transaction
          .select()
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, command.petId),
              eq(petMemberships.accountId, command.requesterAccountId),
            ),
          )
          .for('update');
        const requester = requesterRows[0];
        if (
          requester?.status !== PetMembershipStatus.ACTIVE ||
          requester.role !== PetMembershipRole.OWNER
        ) {
          return { outcome: 'PET_NOT_FOUND' };
        }

        const targetRows = await transaction
          .select()
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, command.petId),
              eq(petMemberships.id, command.targetMembershipId),
            ),
          )
          .for('update');
        const target = targetRows[0];
        if (target === undefined) return { outcome: 'PET_MEMBER_NOT_FOUND' };
        const membership: PetMembership = PetMembership.reconstitute({
          id: MembershipId.from(target.id),
          accountId: AccountId.from(target.accountId),
          role: target.role as PetMembershipRoleType,
          status: target.status as PetMembershipStatusType,
        });
        let hasAnotherActiveOwner: boolean = false;
        if (
          requester.id !== target.id &&
          membership.status === PetMembershipStatus.ACTIVE &&
          membership.role === PetMembershipRole.OWNER
        ) {
          const otherOwnerRows = await transaction
            .select({
              hasAnotherActiveOwner: exists(
                transaction
                  .select({ id: petMemberships.id })
                  .from(petMemberships)
                  .where(
                    and(
                      eq(petMemberships.petId, command.petId),
                      eq(petMemberships.role, PetMembershipRole.OWNER),
                      eq(petMemberships.status, PetMembershipStatus.ACTIVE),
                      ne(petMemberships.id, target.id),
                    ),
                  ),
              ),
            })
            .from(pets)
            .where(eq(pets.id, command.petId));
          hasAnotherActiveOwner =
            otherOwnerRows[0]?.hasAnotherActiveOwner === true;
        }
        const decision: PetMemberRemovalDecision =
          PetMemberRemovalPolicy.decide(
            MembershipId.from(requester.id),
            membership,
            hasAnotherActiveOwner,
          );
        if (decision.outcome !== 'REMOVED')
          return { outcome: decision.outcome };
        if (decision.membershipToSave !== null) {
          const changedRows = await transaction
            .update(petMemberships)
            .set({ status: decision.membershipToSave.status })
            .where(
              and(
                eq(petMemberships.id, target.id),
                eq(petMemberships.petId, command.petId),
                eq(petMemberships.accountId, target.accountId),
                eq(petMemberships.role, membership.role),
                eq(petMemberships.status, PetMembershipStatus.ACTIVE),
              ),
            )
            .returning({ id: petMemberships.id });
          if (changedRows.length !== 1)
            throw new Error('Membership transition did not update one row');
        }
        return { outcome: 'REMOVED' };
      },
      { isolationLevel: 'read committed' },
    );
  }

  async save(pet: Pet): Promise<void> {
    await this.databaseService.connection.transaction(async (transaction) => {
      await transaction.insert(pets).values({
        id: pet.id.value,
        name: pet.name,
        species: pet.species,
        breedName: pet.breed.name,
        breedKind: pet.breed.kind,
        sex: pet.sex,
        birthDate: pet.birthInformation.date,
        birthDateAccuracy: pet.birthInformation.accuracy,
        color: pet.color ?? null,
        distinctiveMarks: pet.distinctiveMarks ?? null,
        microchip: pet.microchip ?? null,
        status: pet.status,
      });

      await transaction.insert(petMemberships).values(
        pet.memberships.map((membership) => ({
          id: membership.id.value,
          petId: pet.id.value,
          accountId: membership.accountId.value,
          role: membership.role,
          status: membership.status,
        })),
      );
    });
  }
}
