import { MeasuredDate } from '../../domain/measured-date/measured-date';
import { Weight } from '../../domain/weight/weight';
import type { WeightRecordRepository } from '../persistence/weight-record.repository';
import type { Clock } from '../time/clock';
import {
    InvalidMeasuredDateError,
    InvalidWeightError,
    PetNotFoundError,
    type RecordedPetWeight,
} from '../record-pet-weight/record-pet-weight';

export interface UpdatePetWeightRecordCommand {
    petId: string;
    weightRecordId: string;
    authenticatedAccountId: string;
    weightKg?: string;
    measuredDate?: string;
}

export class WeightRecordNotFoundError extends Error {
    constructor() {
        super('Weight record was not found');
    }
}

export class UpdatePetWeightRecord {
    constructor(
        private readonly repository: WeightRecordRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: UpdatePetWeightRecordCommand): Promise<RecordedPetWeight> {
        let weight: Weight | undefined;

        if (command.weightKg !== undefined) {
            try {
                weight = Weight.fromKilograms(command.weightKg);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidWeightError(error);
                }

                throw error;
            }
        }

        let measuredDate: MeasuredDate | undefined;

        if (command.measuredDate !== undefined) {
            try {
                const today: string = this.clock.now().toISOString().slice(0, 10);

                measuredDate = MeasuredDate.from(command.measuredDate, today);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidMeasuredDateError(error);
                }

                throw error;
            }
        }

        const outcome = await this.repository.correctIfPetWritable({
            petId: command.petId,
            weightRecordId: command.weightRecordId,
            authenticatedAccountId: command.authenticatedAccountId,
            weight,
            measuredDate,
        });

        if (outcome.status === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        if (outcome.status === 'WEIGHT_RECORD_NOT_FOUND') {
            throw new WeightRecordNotFoundError();
        }

        const record = outcome.record;

        return {
            id: record.id.value,
            petId: record.petId.value,
            weightKg: record.weight.kilograms,
            measuredDate: record.measuredDate.value,
            recordedByAccountId: record.recordedByAccountId.value,
        };
    }
}
