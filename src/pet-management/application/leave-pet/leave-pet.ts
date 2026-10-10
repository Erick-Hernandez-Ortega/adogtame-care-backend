import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { LeavePetPersistenceResult, PetRepository } from '../persistence/pet.repository';

export class LastOwnerCannotLeaveError extends Error {
    constructor() {
        super('Last owner cannot leave a pet');
    }
}

export class LeavePet {
    constructor(private readonly petRepository: PetRepository) {}

    async execute(petId: string, authenticatedAccountId: string): Promise<void> {
        const result: LeavePetPersistenceResult = await this.petRepository.leave(
            petId,
            authenticatedAccountId,
        );

        switch (result.outcome) {
            case 'PET_NOT_FOUND':
                throw new PetNotFoundError();
            case 'LAST_OWNER_CANNOT_LEAVE':
                throw new LastOwnerCannotLeaveError();
            case 'LEFT':
            case 'ALREADY_LEFT':
                return;
        }
    }
}
