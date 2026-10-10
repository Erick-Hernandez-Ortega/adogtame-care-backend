import { InvalidMedicalConditionResolvedDateValueError } from '../../domain/pet-medical-condition/pet-medical-condition';
import type { PetMedicalConditionRepository } from '../persistence/pet-medical-condition.repository';
import type { Clock } from '../time/clock';
import { PetNotFoundError } from '../record-pet-medical-condition/record-pet-medical-condition';
import {
    PetMedicalConditionNotFoundError,
    type UpdatedPetMedicalCondition,
} from '../update-pet-medical-condition/update-pet-medical-condition';

export interface ResolvePetMedicalConditionCommand {
    petId: string;
    conditionId: string;
    authenticatedAccountId: string;
    resolvedDate: string | null;
}

export class InvalidMedicalConditionResolvedDateError extends Error {
    constructor(cause: InvalidMedicalConditionResolvedDateValueError) {
        super(cause.message, { cause });
    }
}

export class ResolvePetMedicalCondition {
    constructor(
        private readonly repository: PetMedicalConditionRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: ResolvePetMedicalConditionCommand): Promise<UpdatedPetMedicalCondition> {
        try {
            const outcome = await this.repository.resolveIfPetWritable({
                ...command,
                getToday: (): string => this.clock.now().toISOString().slice(0, 10),
            });

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
        } catch (error: unknown) {
            if (error instanceof InvalidMedicalConditionResolvedDateValueError) {
                throw new InvalidMedicalConditionResolvedDateError(error);
            }

            throw error;
        }
    }
}
