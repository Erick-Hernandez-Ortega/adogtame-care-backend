import type {
    PetMedicalConditionAccess,
    PetMedicalConditionRepository,
    DeletePetMedicalConditionOutcome,
} from '../persistence/pet-medical-condition.repository';
import { PetNotFoundError } from '../record-pet-medical-condition/record-pet-medical-condition';
import { PetMedicalConditionNotFoundError } from '../update-pet-medical-condition/update-pet-medical-condition';

export class DeletePetMedicalCondition {
    constructor(private readonly repository: PetMedicalConditionRepository) {}

    async execute(command: PetMedicalConditionAccess): Promise<void> {
        const outcome: DeletePetMedicalConditionOutcome =
            await this.repository.deleteIfPetWritable(command);

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome === 'PET_MEDICAL_CONDITION_NOT_FOUND') {
            throw new PetMedicalConditionNotFoundError();
        }
    }
}
