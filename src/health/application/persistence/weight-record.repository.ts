import type { WeightRecord } from '../../domain/weight-record/weight-record';
import type { MeasuredDate } from '../../domain/measured-date/measured-date';
import type { Weight } from '../../domain/weight/weight';

export const WEIGHT_RECORD_REPOSITORY: unique symbol = Symbol('WEIGHT_RECORD_REPOSITORY');

export type CreateWeightRecordOutcome = 'CREATED' | 'PET_NOT_FOUND';
export type UpdateWeightRecordOutcome =
    | { status: 'UPDATED' | 'UNCHANGED'; record: WeightRecord }
    | { status: 'PET_NOT_FOUND' }
    | { status: 'WEIGHT_RECORD_NOT_FOUND' };
export type DeleteWeightRecordOutcome = 'DELETED' | 'PET_NOT_FOUND' | 'WEIGHT_RECORD_NOT_FOUND';

export interface WeightRecordAccess {
    petId: string;
    weightRecordId: string;
    authenticatedAccountId: string;
}

export interface WeightRecordCorrection extends WeightRecordAccess {
    weight?: Weight;
    measuredDate?: MeasuredDate;
}

export interface WeightRecordRepository {
    createIfPetWritable(weightRecord: WeightRecord): Promise<CreateWeightRecordOutcome>;
    correctIfPetWritable(correction: WeightRecordCorrection): Promise<UpdateWeightRecordOutcome>;
    deleteIfPetWritable(access: WeightRecordAccess): Promise<DeleteWeightRecordOutcome>;
}
