import { AppliedDate } from '../../domain/applied-date/applied-date';
import { NextDueDate } from '../../domain/next-due-date/next-due-date';
import { NextDueDateNotAfterAppliedDateError } from '../../domain/vaccination-record/vaccination-record';
import { VaccineName } from '../../domain/vaccine-name/vaccine-name';
import type { VaccinationRecordRepository } from '../persistence/vaccination-record.repository';
import {
    InvalidAppliedDateError,
    InvalidNextDueDateError,
    InvalidVaccineNameError,
    PetNotFoundError,
    type RecordedVaccination,
} from '../record-vaccination/record-vaccination';
import type { Clock } from '../time/clock';

export interface UpdateVaccinationRecordCommand {
    petId: string;
    vaccinationRecordId: string;
    authenticatedAccountId: string;
    vaccineName?: string;
    appliedDate?: string;
    nextDueDate?: string | null;
}

export class VaccinationRecordNotFoundError extends Error {
    constructor() {
        super('Vaccination record was not found');
    }
}

export class UpdateVaccinationRecord {
    constructor(
        private readonly repository: VaccinationRecordRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: UpdateVaccinationRecordCommand): Promise<RecordedVaccination> {
        const today: string = this.clock.now().toISOString().slice(0, 10);
        let vaccineName: VaccineName | undefined;

        if (command.vaccineName !== undefined) {
            try {
                vaccineName = VaccineName.from(command.vaccineName);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidVaccineNameError(error);
                }

                throw error;
            }
        }

        let appliedDate: AppliedDate | undefined;

        if (command.appliedDate !== undefined) {
            try {
                appliedDate = AppliedDate.from(command.appliedDate, today);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidAppliedDateError(error);
                }

                throw error;
            }
        }

        let nextDueDate: NextDueDate | null | undefined;

        if (command.nextDueDate !== undefined) {
            try {
                nextDueDate =
                    command.nextDueDate === null ? null : NextDueDate.from(command.nextDueDate);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidNextDueDateError(error);
                }

                throw error;
            }
        }

        try {
            const outcome = await this.repository.correctIfPetWritable({
                petId: command.petId,
                vaccinationRecordId: command.vaccinationRecordId,
                authenticatedAccountId: command.authenticatedAccountId,
                vaccineName,
                appliedDate,
                nextDueDate,
            });

            if (outcome.status === 'PET_NOT_FOUND') {
                throw new PetNotFoundError();
            }

            if (outcome.status === 'VACCINATION_RECORD_NOT_FOUND') {
                throw new VaccinationRecordNotFoundError();
            }

            const record = outcome.record;

            return {
                id: record.id.value,
                petId: record.petId.value,
                vaccineName: record.vaccineName.value,
                appliedDate: record.appliedDate.value,
                nextDueDate: record.nextDueDate?.value ?? null,
                recordedByAccountId: record.recordedByAccountId.value,
            };
        } catch (error: unknown) {
            if (error instanceof NextDueDateNotAfterAppliedDateError) {
                throw new InvalidNextDueDateError(error);
            }

            throw error;
        }
    }
}
