import { PetNotFoundError } from '../errors/pet-not-found.error';
import type { ArchivePetCommand, PetRepository } from '../persistence/pet.repository';

export class ArchivePet {
    constructor(private readonly petRepository: PetRepository) {}

    async execute(command: ArchivePetCommand): Promise<void> {
        const result = await this.petRepository.archiveIfOwned(command);

        switch (result.outcome) {
            case 'PET_NOT_FOUND':
                throw new PetNotFoundError();
            case 'ARCHIVED':
            case 'ALREADY_ARCHIVED':
                return;
        }
    }
}
