import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  decideCollaboratorLeave,
  type CollaboratorLeaveDecision,
} from '../../../application/leave-pet-as-collaborator/leave-pet-as-collaborator';
import type {
  LeavePetPersistenceResult,
  PetRepository,
} from '../../../application/persistence/pet.repository';
import { BirthInformation } from '../../../domain/birth-information/birth-information';
import { Breed } from '../../../domain/breed/breed';
import {
  AccountId,
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

  async leaveAsCollaborator(
    petId: string,
    authenticatedAccountId: string,
  ): Promise<LeavePetPersistenceResult> {
    return this.databaseService.connection.transaction(
      async (transaction) => {
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
        const decision: CollaboratorLeaveDecision =
          decideCollaboratorLeave(membership);
        if (decision.outcome === 'OWNER_LEAVE_NOT_SUPPORTED') {
          return { outcome: 'OWNER_LEAVE_NOT_SUPPORTED' };
        }

        if (decision.membershipToSave !== null) {
          const changedRows = await transaction
            .update(petMemberships)
            .set({ status: decision.membershipToSave.status })
            .where(
              and(
                eq(petMemberships.id, row.id),
                eq(petMemberships.petId, petId),
                eq(petMemberships.accountId, authenticatedAccountId),
                eq(petMemberships.role, PetMembershipRole.COLLABORATOR),
                eq(petMemberships.status, PetMembershipStatus.ACTIVE),
              ),
            )
            .returning({ id: petMemberships.id });
          if (changedRows.length !== 1) {
            throw new Error('Membership transition did not update one row');
          }
        }

        return {
          outcome: 'LEFT',
          petId,
          membershipId: row.id,
          role: PetMembershipRole.COLLABORATOR,
          status: PetMembershipStatus.INACTIVE,
        };
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
