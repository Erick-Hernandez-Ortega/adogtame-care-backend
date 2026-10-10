import { AppliedDate } from '../../domain/applied-date/applied-date';
import { NextDueDate } from '../../domain/next-due-date/next-due-date';
import {
    PetId,
    RecordedByAccountId,
    VaccinationRecord,
} from '../../domain/vaccination-record/vaccination-record';
import { VaccineName } from '../../domain/vaccine-name/vaccine-name';
import type { VaccinationRecordRepository } from '../persistence/vaccination-record.repository';
import type { Clock } from '../time/clock';

export interface RecordVaccinationCommand {
    petId: string;
    vaccineName: string;
    appliedDate: string;
    nextDueDate: string | null;
    authenticatedAccountId: string;
}

export interface RecordedVaccination {
    id: string;
    petId: string;
    vaccineName: string;
    appliedDate: string;
    nextDueDate: string | null;
    recordedByAccountId: string;
}

export class InvalidVaccineNameError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidAppliedDateError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidNextDueDateError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class RecordVaccination {
    constructor(
        private readonly repository: VaccinationRecordRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: RecordVaccinationCommand): Promise<RecordedVaccination> {
        let vaccineName: VaccineName;

        try {
            vaccineName = VaccineName.from(command.vaccineName);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidVaccineNameError(error);
            }

            throw error;
        }

        const today: string = this.clock.now().toISOString().slice(0, 10);
        let appliedDate: AppliedDate;

        try {
            appliedDate = AppliedDate.from(command.appliedDate, today);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidAppliedDateError(error);
            }

            throw error;
        }

        let nextDueDate: NextDueDate | null = null;

        try {
            if (command.nextDueDate !== null) {
                nextDueDate = NextDueDate.from(command.nextDueDate);
            }
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidNextDueDateError(error);
            }

            throw error;
        }

        let record: VaccinationRecord;

        try {
            record = VaccinationRecord.create({
                petId: PetId.from(command.petId),
                vaccineName,
                appliedDate,
                nextDueDate,
                recordedByAccountId: RecordedByAccountId.from(command.authenticatedAccountId),
            });
        } catch (error: unknown) {
            if (error instanceof RangeError) {
                throw new InvalidNextDueDateError(error);
            }

            throw error;
        }

        const outcome = await this.repository.createIfPetWritable(
            record,
            command.authenticatedAccountId,
        );

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        return {
            id: record.id.value,
            petId: record.petId.value,
            vaccineName: record.vaccineName.value,
            appliedDate: record.appliedDate.value,
            nextDueDate: record.nextDueDate?.value ?? null,
            recordedByAccountId: record.recordedByAccountId.value,
        };
    }
}
