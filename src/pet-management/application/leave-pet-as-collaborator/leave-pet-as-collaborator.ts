import {
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from '../../domain/pet-membership/pet-membership';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { PetRepository } from '../persistence/pet.repository';

export type CollaboratorLeaveDecision =
  | { outcome: 'OWNER_LEAVE_NOT_SUPPORTED'; membershipToSave: null }
  | { outcome: 'LEFT'; membershipToSave: PetMembership | null };

export interface LeftPetAsCollaborator {
  petId: string;
  membershipId: string;
  role: 'COLLABORATOR';
  status: 'INACTIVE';
}

export class OwnerLeaveNotSupportedError extends Error {
  constructor() {
    super('Owner leave is not supported');
  }
}

export function decideCollaboratorLeave(
  membership: PetMembership,
): CollaboratorLeaveDecision {
  if (membership.role === PetMembershipRole.OWNER) {
    return { outcome: 'OWNER_LEAVE_NOT_SUPPORTED', membershipToSave: null };
  }
  if (membership.status === PetMembershipStatus.INACTIVE) {
    return { outcome: 'LEFT', membershipToSave: null };
  }
  return {
    outcome: 'LEFT',
    membershipToSave: membership.leaveAsCollaborator(),
  };
}

export class LeavePetAsCollaborator {
  constructor(private readonly petRepository: PetRepository) {}

  async execute(
    petId: string,
    authenticatedAccountId: string,
  ): Promise<LeftPetAsCollaborator> {
    const result = await this.petRepository.leaveAsCollaborator(
      petId,
      authenticatedAccountId,
    );
    switch (result.outcome) {
      case 'PET_NOT_FOUND':
        throw new PetNotFoundError();
      case 'OWNER_LEAVE_NOT_SUPPORTED':
        throw new OwnerLeaveNotSupportedError();
      case 'LEFT':
        return {
          petId: result.petId,
          membershipId: result.membershipId,
          role: result.role,
          status: result.status,
        };
    }
  }
}
