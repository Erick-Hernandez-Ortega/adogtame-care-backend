import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
  PetRepository,
  PromoteCollaboratorCommand,
  PromoteCollaboratorPersistenceResult,
} from '../persistence/pet.repository';
import { PetMemberNotFoundError } from '../remove-pet-member/remove-pet-member';

export type { PromoteCollaboratorCommand } from '../persistence/pet.repository';

export class PetMemberInactiveError extends Error {
  constructor() {
    super('Pet member is inactive');
  }
}

export class PromoteCollaboratorToOwner {
  constructor(private readonly petRepository: PetRepository) {}

  async execute(command: PromoteCollaboratorCommand): Promise<void> {
    const result: PromoteCollaboratorPersistenceResult =
      await this.petRepository.promoteCollaboratorIfOwned(command);
    switch (result.outcome) {
      case 'PET_NOT_FOUND':
        throw new PetNotFoundError();
      case 'PET_MEMBER_NOT_FOUND':
        throw new PetMemberNotFoundError();
      case 'PET_MEMBER_INACTIVE':
        throw new PetMemberInactiveError();
      case 'PROMOTED':
      case 'ALREADY_OWNER':
        return;
    }
  }
}
