import type {
    PetMedicationAccess,
    PetMedicationRepository,
    DeletePetMedicationOutcome,
} from '../persistence/pet-medication.repository';
import { PetNotFoundError } from '../record-pet-medication/record-pet-medication';
import { PetMedicationNotFoundError } from '../update-pet-medication/update-pet-medication';

export class DeletePetMedication {
    constructor(private readonly repository: PetMedicationRepository) {}

    async execute(command: PetMedicationAccess): Promise<void> {
        const outcome: DeletePetMedicationOutcome =
            await this.repository.deleteIfPetWritable(command);

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome === 'PET_MEDICATION_NOT_FOUND') {
            throw new PetMedicationNotFoundError();
        }
    }
}
