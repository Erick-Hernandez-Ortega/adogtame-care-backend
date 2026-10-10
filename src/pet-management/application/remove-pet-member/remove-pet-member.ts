import { PetNotFoundError } from '../errors/pet-not-found.error';
import type {
    PetRepository,
    RemovePetMemberCommand,
    RemovePetMemberPersistenceResult,
} from '../persistence/pet.repository';

export type { RemovePetMemberCommand } from '../persistence/pet.repository';

export class PetMemberNotFoundError extends Error {
    constructor() {
        super('Pet member was not found');
    }
}

export class SelfRemovalNotSupportedError extends Error {
    constructor() {
        super('Self-removal is not supported; use Leave instead');
    }
}

export class LastOwnerCannotBeRemovedError extends Error {
    constructor() {
        super('Last owner cannot be removed from a pet');
    }
}

export class RemovePetMember {
    constructor(private readonly petRepository: PetRepository) {}

    async execute(command: RemovePetMemberCommand): Promise<void> {
        const result: RemovePetMemberPersistenceResult =
            await this.petRepository.removeMemberIfOwned(command);

        switch (result.outcome) {
            case 'PET_NOT_FOUND':
                throw new PetNotFoundError();
            case 'PET_MEMBER_NOT_FOUND':
                throw new PetMemberNotFoundError();
            case 'SELF_REMOVAL_NOT_SUPPORTED':
                throw new SelfRemovalNotSupportedError();
            case 'LAST_OWNER_CANNOT_BE_REMOVED':
                throw new LastOwnerCannotBeRemovedError();
            case 'REMOVED':
                return;
        }
    }
}
