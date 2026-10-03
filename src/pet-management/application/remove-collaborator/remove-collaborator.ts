import {
  PetMembership,
  PetMembershipRole,
  PetMembershipStatus,
} from '../../domain/pet-membership/pet-membership';
import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
  PetRepository,
  RemoveCollaboratorCommand,
  RemoveCollaboratorPersistenceResult,
} from '../persistence/pet.repository';

export type { RemoveCollaboratorCommand } from '../persistence/pet.repository';

export class PetMemberNotFoundError extends Error {
  constructor() {
    super('Pet member was not found');
  }
}

export class OwnerRemovalNotSupportedError extends Error {
  constructor() {
    super('Owner removal is not supported');
  }
}

export type CollaboratorRemovalDecision =
  | { outcome: 'OWNER_REMOVAL_NOT_SUPPORTED'; membershipToSave: null }
  | { outcome: 'REMOVED'; membershipToSave: PetMembership | null };

export function decideCollaboratorRemoval(
  membership: PetMembership,
): CollaboratorRemovalDecision {
  if (membership.role === PetMembershipRole.OWNER) {
    return { outcome: 'OWNER_REMOVAL_NOT_SUPPORTED', membershipToSave: null };
  }
  if (membership.status === PetMembershipStatus.INACTIVE) {
    return { outcome: 'REMOVED', membershipToSave: null };
  }
  return {
    outcome: 'REMOVED',
    membershipToSave: membership.removeAsCollaborator(),
  };
}

export class RemoveCollaborator {
  constructor(private readonly petRepository: PetRepository) {}

  async execute(command: RemoveCollaboratorCommand): Promise<void> {
    const result: RemoveCollaboratorPersistenceResult =
      await this.petRepository.removeCollaboratorIfOwned(command);
    switch (result.outcome) {
      case 'PET_NOT_FOUND':
        throw new PetNotFoundError();
      case 'PET_MEMBER_NOT_FOUND':
        throw new PetMemberNotFoundError();
      case 'OWNER_REMOVAL_NOT_SUPPORTED':
        throw new OwnerRemovalNotSupportedError();
      case 'REMOVED':
        return;
    }
  }
}
