import type { Pet } from '../../domain/pet/pet';

export const PET_REPOSITORY: unique symbol = Symbol('PET_REPOSITORY');

export type LeavePetPersistenceResult =
  | { outcome: 'PET_NOT_FOUND' | 'OWNER_LEAVE_NOT_SUPPORTED' }
  | {
      outcome: 'LEFT';
      petId: string;
      membershipId: string;
      role: 'COLLABORATOR';
      status: 'INACTIVE';
    };

export interface PetRepository {
  save(pet: Pet): Promise<void>;
  correctProfileIfOwned(
    petId: string,
    authenticatedAccountId: string,
    correct: (pet: Pet) => Pet,
  ): Promise<Pet | null>;
  leaveAsCollaborator(
    petId: string,
    authenticatedAccountId: string,
  ): Promise<LeavePetPersistenceResult>;
}
