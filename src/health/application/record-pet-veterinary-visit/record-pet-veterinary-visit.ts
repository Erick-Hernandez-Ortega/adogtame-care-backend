import { VisitDate } from '../../domain/visit-date/visit-date';
import { VeterinaryVisitReason } from '../../domain/veterinary-visit-reason/veterinary-visit-reason';
import {
    InvalidVeterinaryVisitDiagnosisValueError,
    InvalidVeterinaryVisitObservationsValueError,
    PetVeterinaryVisit,
    PetId,
    RecordedByAccountId,
} from '../../domain/pet-veterinary-visit/pet-veterinary-visit';
import type {
    PetVeterinaryVisitRepository,
    CreatePetVeterinaryVisitOutcome,
} from '../persistence/pet-veterinary-visit.repository';
import type { Clock } from '../time/clock';

export interface RecordPetVeterinaryVisitCommand {
    petId: string;
    authenticatedAccountId: string;
    reason: string;
    visitDate: string;
    diagnosis?: string | null;
    observations?: string | null;
}

export interface RecordedPetVeterinaryVisit {
    id: string;
    petId: string;
    reason: string;
    visitDate: string;
    diagnosis: string | null;
    observations: string | null;
    recordedByAccountId: string;
}

export class InvalidVeterinaryVisitReasonError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}
export class InvalidVeterinaryVisitDateError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}
export class InvalidVeterinaryVisitObservationsError extends Error {
    constructor(cause: InvalidVeterinaryVisitObservationsValueError) {
        super(cause.message, { cause });
    }
}
export class InvalidVeterinaryVisitDiagnosisError extends Error {
    constructor(cause: InvalidVeterinaryVisitDiagnosisValueError) {
        super(cause.message, { cause });
    }
}
export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class RecordPetVeterinaryVisit {
    constructor(
        private readonly repository: PetVeterinaryVisitRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: RecordPetVeterinaryVisitCommand): Promise<RecordedPetVeterinaryVisit> {
        let reason: VeterinaryVisitReason;

        try {
            reason = VeterinaryVisitReason.from(command.reason);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidVeterinaryVisitReasonError(error);
            }

            throw error;
        }

        const today: string = this.clock.now().toISOString().slice(0, 10);
        let visitDate: VisitDate;

        try {
            visitDate = VisitDate.from(command.visitDate, today);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidVeterinaryVisitDateError(error);
            }

            throw error;
        }

        let visit: PetVeterinaryVisit;

        try {
            visit = PetVeterinaryVisit.create({
                petId: PetId.from(command.petId),
                reason,
                visitDate,
                diagnosis: command.diagnosis,
                observations: command.observations,
                recordedByAccountId: RecordedByAccountId.from(command.authenticatedAccountId),
            });
        } catch (error: unknown) {
            if (error instanceof InvalidVeterinaryVisitDiagnosisValueError) {
                throw new InvalidVeterinaryVisitDiagnosisError(error);
            }

            if (error instanceof InvalidVeterinaryVisitObservationsValueError) {
                throw new InvalidVeterinaryVisitObservationsError(error);
            }

            throw error;
        }

        const outcome: CreatePetVeterinaryVisitOutcome = await this.repository.createIfPetWritable(
            visit,
            command.authenticatedAccountId,
        );

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

        return {
            id: visit.id.value,
            petId: visit.petId.value,
            reason: visit.reason.value,
            visitDate: visit.visitDate.value,
            diagnosis: visit.diagnosis,
            observations: visit.observations,
            recordedByAccountId: visit.recordedByAccountId.value,
        };
    }
}
