import { MeasuredDate } from '../../domain/measured-date/measured-date';
import {
  PetId,
  RecordedByAccountId,
  WeightRecord,
} from '../../domain/weight-record/weight-record';
import { Weight } from '../../domain/weight/weight';
import type { WeightRecordRepository } from '../persistence/weight-record.repository';
import type { Clock } from '../time/clock';

export interface RecordPetWeightCommand {
  petId: string;
  weightKg: string;
  measuredDate: string;
  authenticatedAccountId: string;
}

export interface RecordedPetWeight {
  id: string;
  petId: string;
  weightKg: string;
  measuredDate: string;
  recordedByAccountId: string;
}

export class InvalidWeightError extends Error {
  constructor(cause: TypeError | RangeError) {
    super(cause.message, { cause });
  }
}

export class InvalidMeasuredDateError extends Error {
  constructor(cause: TypeError | RangeError) {
    super(cause.message, { cause });
  }
}

export class PetNotFoundError extends Error {
  constructor() {
    super('Pet was not found');
  }
}

export class RecordPetWeight {
  constructor(
    private readonly weightRecordRepository: WeightRecordRepository,
    private readonly clock: Clock,
  ) {}

  async execute(command: RecordPetWeightCommand): Promise<RecordedPetWeight> {
    let weight: Weight;
    try {
      weight = Weight.fromKilograms(command.weightKg);
    } catch (error: unknown) {
      if (error instanceof TypeError || error instanceof RangeError) {
        throw new InvalidWeightError(error);
      }
      throw error;
    }

    let measuredDate: MeasuredDate;
    try {
      const today: string = this.clock.now().toISOString().slice(0, 10);
      measuredDate = MeasuredDate.from(command.measuredDate, today);
    } catch (error: unknown) {
      if (error instanceof TypeError || error instanceof RangeError) {
        throw new InvalidMeasuredDateError(error);
      }
      throw error;
    }

    const weightRecord: WeightRecord = WeightRecord.create({
      petId: PetId.from(command.petId),
      weight,
      measuredDate,
      recordedByAccountId: RecordedByAccountId.from(
        command.authenticatedAccountId,
      ),
    });
    const outcome =
      await this.weightRecordRepository.createIfPetWritable(weightRecord);
    if (outcome === 'PET_NOT_FOUND') {
      throw new PetNotFoundError();
    }

    return {
      id: weightRecord.id.value,
      petId: weightRecord.petId.value,
      weightKg: weightRecord.weight.kilograms,
      measuredDate: weightRecord.measuredDate.value,
      recordedByAccountId: weightRecord.recordedByAccountId.value,
    };
  }
}
