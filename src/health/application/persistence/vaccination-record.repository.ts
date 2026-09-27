import type { VaccinationRecord } from '../../domain/vaccination-record/vaccination-record';
import type { AppliedDate } from '../../domain/applied-date/applied-date';
import type { NextDueDate } from '../../domain/next-due-date/next-due-date';
import type { VaccineName } from '../../domain/vaccine-name/vaccine-name';

export const VACCINATION_RECORD_REPOSITORY: unique symbol = Symbol(
  'VACCINATION_RECORD_REPOSITORY',
);

export type CreateVaccinationRecordOutcome = 'CREATED' | 'PET_NOT_FOUND';
export type UpdateVaccinationRecordOutcome =
  | { status: 'UPDATED' | 'UNCHANGED'; record: VaccinationRecord }
  | { status: 'PET_NOT_FOUND' }
  | { status: 'VACCINATION_RECORD_NOT_FOUND' };
export type DeleteVaccinationRecordOutcome =
  'DELETED' | 'PET_NOT_FOUND' | 'VACCINATION_RECORD_NOT_FOUND';

export interface VaccinationRecordAccess {
  petId: string;
  vaccinationRecordId: string;
  authenticatedAccountId: string;
}

export interface VaccinationRecordCorrection extends VaccinationRecordAccess {
  vaccineName?: VaccineName;
  appliedDate?: AppliedDate;
  nextDueDate?: NextDueDate | null;
}

export interface VaccinationRecordRepository {
  createIfPetWritable(
    record: VaccinationRecord,
    authenticatedAccountId: string,
  ): Promise<CreateVaccinationRecordOutcome>;
  correctIfPetWritable(
    correction: VaccinationRecordCorrection,
  ): Promise<UpdateVaccinationRecordOutcome>;
  deleteIfPetWritable(
    access: VaccinationRecordAccess,
  ): Promise<DeleteVaccinationRecordOutcome>;
}
