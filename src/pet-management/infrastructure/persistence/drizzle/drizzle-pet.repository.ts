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
import type { Pet } from '../../../domain/pet/pet';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import { petMemberships, pets } from './pet-management.schema';

@Injectable()
export class DrizzlePetRepository implements PetRepository {
  constructor(private readonly databaseService: DatabaseService) {}

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
