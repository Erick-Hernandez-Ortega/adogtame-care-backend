import type {
    PetVeterinaryVisitAccess,
    PetVeterinaryVisitRepository,
    DeletePetVeterinaryVisitOutcome,
} from '../persistence/pet-veterinary-visit.repository';
import { PetNotFoundError } from '../record-pet-veterinary-visit/record-pet-veterinary-visit';
import { PetVeterinaryVisitNotFoundError } from '../update-pet-veterinary-visit/update-pet-veterinary-visit';

export class DeletePetVeterinaryVisit {
    constructor(private readonly repository: PetVeterinaryVisitRepository) {}

    async execute(command: PetVeterinaryVisitAccess): Promise<void> {
        const outcome: DeletePetVeterinaryVisitOutcome =
            await this.repository.deleteIfPetWritable(command);

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome === 'PET_VETERINARY_VISIT_NOT_FOUND') {
            throw new PetVeterinaryVisitNotFoundError();
        }
    }
}
