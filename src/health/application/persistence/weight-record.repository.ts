import type { WeightRecord } from '../../domain/weight-record/weight-record';

export const WEIGHT_RECORD_REPOSITORY: unique symbol = Symbol(
  'WEIGHT_RECORD_REPOSITORY',
);

export type CreateWeightRecordOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface WeightRecordRepository {
  createIfPetWritable(
    weightRecord: WeightRecord,
  ): Promise<CreateWeightRecordOutcome>;
}
