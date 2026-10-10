import {
  InvalidMedicalConditionNameValueError,
  InvalidMedicalConditionDiagnosedDateValueError,
  InvalidMedicalConditionNotesValueError,
  type MedicalConditionStatus,
} from '../../domain/pet-medical-condition/pet-medical-condition';
import type { PetMedicalConditionRepository } from '../persistence/pet-medical-condition.repository';
import type { Clock } from '../time/clock';
import {
  InvalidMedicalConditionNameError,
  InvalidMedicalConditionDiagnosedDateError,
  InvalidMedicalConditionNotesError,
  PetNotFoundError,
} from '../record-pet-medical-condition/record-pet-medical-condition';

export interface UpdatePetMedicalConditionCommand {
  petId: string;
  conditionId: string;
  authenticatedAccountId: string;
  name?: string;
  diagnosedDate?: string | null;
  notes?: string | null;
}

export interface UpdatedPetMedicalCondition {
  id: string;
  petId: string;
  name: string;
  status: MedicalConditionStatus;
  diagnosedDate: string | null;
  notes: string | null;
  recordedByAccountId: string;
}

export class PetMedicalConditionNotFoundError extends Error {
  constructor() {
    super('Pet medical condition was not found');
  }
}

export class UpdatePetMedicalCondition {
  constructor(
    private readonly repository: PetMedicalConditionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: UpdatePetMedicalConditionCommand,
  ): Promise<UpdatedPetMedicalCondition> {
    try {
      const outcome = await this.repository.correctIfPetWritable({
        ...command,
        getToday: (): string => this.clock.now().toISOString().slice(0, 10),
      });
      if (outcome.status === 'PET_NOT_FOUND') throw new PetNotFoundError();
      if (outcome.status === 'PET_MEDICAL_CONDITION_NOT_FOUND')
        throw new PetMedicalConditionNotFoundError();
      const condition = outcome.condition;
      return {
        id: condition.id.value,
        petId: condition.petId.value,
        name: condition.name.value,
        status: condition.status,
        diagnosedDate: condition.diagnosedDate?.value ?? null,
        notes: condition.notes,
        recordedByAccountId: condition.recordedByAccountId.value,
      };
    } catch (error: unknown) {
      if (error instanceof InvalidMedicalConditionNameValueError)
        throw new InvalidMedicalConditionNameError(error);
      if (error instanceof InvalidMedicalConditionDiagnosedDateValueError)
        throw new InvalidMedicalConditionDiagnosedDateError(error);
      if (error instanceof InvalidMedicalConditionNotesValueError)
        throw new InvalidMedicalConditionNotesError(error);
      throw error;
    }
  }
}
