import type { VaccinationRecord } from '../../domain/vaccination-record/vaccination-record';

export const VACCINATION_RECORD_REPOSITORY: unique symbol = Symbol(
  'VACCINATION_RECORD_REPOSITORY',
);

export type CreateVaccinationRecordOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface VaccinationRecordRepository {
  createIfPetWritable(
    record: VaccinationRecord,
    authenticatedAccountId: string,
  ): Promise<CreateVaccinationRecordOutcome>;
}
