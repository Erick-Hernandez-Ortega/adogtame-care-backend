import type { Pet } from '../../domain/pet/pet';

export const PET_REPOSITORY: unique symbol = Symbol('PET_REPOSITORY');

export interface LeavePetPersistenceResult {
  outcome:
    'PET_NOT_FOUND' | 'LAST_OWNER_CANNOT_LEAVE' | 'LEFT' | 'ALREADY_LEFT';
}

export interface RemoveCollaboratorCommand {
  requesterAccountId: string;
  petId: string;
  targetMembershipId: string;
}

export interface RemoveCollaboratorPersistenceResult {
  outcome:
    | 'PET_NOT_FOUND'
    | 'PET_MEMBER_NOT_FOUND'
    | 'OWNER_REMOVAL_NOT_SUPPORTED'
    | 'REMOVED';
}

export interface PromoteCollaboratorCommand {
  requesterAccountId: string;
  petId: string;
  targetMembershipId: string;
}

export interface PromoteCollaboratorPersistenceResult {
  outcome:
    | 'PROMOTED'
    | 'ALREADY_OWNER'
    | 'PET_NOT_FOUND'
    | 'PET_MEMBER_NOT_FOUND'
    | 'PET_MEMBER_INACTIVE';
}

export interface PetRepository {
  promoteCollaboratorIfOwned(
    command: PromoteCollaboratorCommand,
  ): Promise<PromoteCollaboratorPersistenceResult>;
  removeCollaboratorIfOwned(
    command: RemoveCollaboratorCommand,
  ): Promise<RemoveCollaboratorPersistenceResult>;
  save(pet: Pet): Promise<void>;
  correctProfileIfOwned(
    petId: string,
    authenticatedAccountId: string,
    correct: (pet: Pet) => Pet,
  ): Promise<Pet | null>;
  leave(
    petId: string,
    authenticatedAccountId: string,
  ): Promise<LeavePetPersistenceResult>;
}
