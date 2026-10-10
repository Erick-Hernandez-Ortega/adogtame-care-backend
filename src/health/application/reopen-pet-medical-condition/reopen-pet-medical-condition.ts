import type { PetMedicalConditionRepository } from '../persistence/pet-medical-condition.repository';
import { PetNotFoundError } from '../record-pet-medical-condition/record-pet-medical-condition';
import {
    PetMedicalConditionNotFoundError,
    type UpdatedPetMedicalCondition,
} from '../update-pet-medical-condition/update-pet-medical-condition';

export interface ReopenPetMedicalConditionCommand {
    petId: string;
    conditionId: string;
    authenticatedAccountId: string;
}

export class ReopenPetMedicalCondition {
    constructor(private readonly repository: PetMedicalConditionRepository) {}

    async execute(command: ReopenPetMedicalConditionCommand): Promise<UpdatedPetMedicalCondition> {
        const outcome = await this.repository.reopenIfPetWritable(command);

        if (outcome.status === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome.status === 'PET_MEDICAL_CONDITION_NOT_FOUND') {
            throw new PetMedicalConditionNotFoundError();
        }

        const condition = outcome.condition;

        return {
            id: condition.id.value,
            petId: condition.petId.value,
            name: condition.name.value,
            status: condition.status,
            diagnosedDate: condition.diagnosedDate?.value ?? null,
            resolvedDate: condition.resolvedDate?.value ?? null,
            notes: condition.notes,
            recordedByAccountId: condition.recordedByAccountId.value,
        };
    }
}
