import { DiagnosedDate } from '../../domain/diagnosed-date/diagnosed-date';
import { MedicalConditionName } from '../../domain/medical-condition-name/medical-condition-name';
import {
  InvalidMedicalConditionNotesValueError,
  MedicalConditionStatus,
  PetMedicalCondition,
  PetId,
  RecordedByAccountId,
} from '../../domain/pet-medical-condition/pet-medical-condition';
import type {
  PetMedicalConditionRepository,
  CreatePetMedicalConditionOutcome,
} from '../persistence/pet-medical-condition.repository';
import type { Clock } from '../time/clock';

export interface RecordPetMedicalConditionCommand {
  petId: string;
  authenticatedAccountId: string;
  name: string;
  diagnosedDate?: string | null;
  notes?: string | null;
}

export interface RecordedPetMedicalCondition {
  id: string;
  petId: string;
  name: string;
  status: typeof MedicalConditionStatus.ACTIVE;
  diagnosedDate: string | null;
  notes: string | null;
  recordedByAccountId: string;
}

export class InvalidMedicalConditionNameError extends Error {
  constructor(cause: TypeError | RangeError) {
    super(cause.message, { cause });
  }
}
export class InvalidMedicalConditionDiagnosedDateError extends Error {
  constructor(cause: TypeError | RangeError) {
    super(cause.message, { cause });
  }
}
export class InvalidMedicalConditionNotesError extends Error {
  constructor(cause: InvalidMedicalConditionNotesValueError) {
    super(cause.message, { cause });
  }
}
export class PetNotFoundError extends Error {
  constructor() {
    super('Pet was not found');
  }
}

export class RecordPetMedicalCondition {
  constructor(
    private readonly repository: PetMedicalConditionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: RecordPetMedicalConditionCommand,
  ): Promise<RecordedPetMedicalCondition> {
    let name: MedicalConditionName;
    try {
      name = MedicalConditionName.from(command.name);
    } catch (error: unknown) {
      if (error instanceof TypeError || error instanceof RangeError)
        throw new InvalidMedicalConditionNameError(error);
      throw error;
    }
    let diagnosedDate: DiagnosedDate | null = null;
    if (command.diagnosedDate !== undefined && command.diagnosedDate !== null) {
      const today: string = this.clock.now().toISOString().slice(0, 10);
      try {
        diagnosedDate = DiagnosedDate.from(command.diagnosedDate, today);
      } catch (error: unknown) {
        if (error instanceof TypeError || error instanceof RangeError)
          throw new InvalidMedicalConditionDiagnosedDateError(error);
        throw error;
      }
    }
    let condition: PetMedicalCondition;
    try {
      condition = PetMedicalCondition.create({
        petId: PetId.from(command.petId),
        name,
        diagnosedDate,
        notes: command.notes,
        recordedByAccountId: RecordedByAccountId.from(
          command.authenticatedAccountId,
        ),
      });
    } catch (error: unknown) {
      if (error instanceof InvalidMedicalConditionNotesValueError)
        throw new InvalidMedicalConditionNotesError(error);
      throw error;
    }
    const outcome: CreatePetMedicalConditionOutcome =
      await this.repository.createIfPetWritable(
        condition,
        command.authenticatedAccountId,
      );
    if (outcome === 'PET_NOT_FOUND') throw new PetNotFoundError();
    return {
      id: condition.id.value,
      petId: condition.petId.value,
      name: condition.name.value,
      status: condition.status,
      diagnosedDate: condition.diagnosedDate?.value ?? null,
      notes: condition.notes,
      recordedByAccountId: condition.recordedByAccountId.value,
    };
  }
}
