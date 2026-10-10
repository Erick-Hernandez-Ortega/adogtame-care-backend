import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { RestorePetCommand, PetRepository } from '../persistence/pet.repository';

export class RestorePet {
    constructor(private readonly petRepository: PetRepository) {}

    async execute(command: RestorePetCommand): Promise<void> {
        const result = await this.petRepository.restoreIfOwned(command);

        switch (result.outcome) {
            case 'PET_NOT_FOUND':
                throw new PetNotFoundError();
            case 'RESTORED':
            case 'ALREADY_ACTIVE':
                return;
        }
    }
}
