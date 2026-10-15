import {
    InvalidVeterinaryVisitReasonValueError,
    InvalidVeterinaryVisitDateValueError,
    InvalidVeterinaryVisitObservationsValueError,
    InvalidVeterinaryVisitDiagnosisValueError,
} from '../../domain/pet-veterinary-visit/pet-veterinary-visit';
import type { PetVeterinaryVisitRepository } from '../persistence/pet-veterinary-visit.repository';
import type { Clock } from '../time/clock';
import {
    InvalidVeterinaryVisitReasonError,
    InvalidVeterinaryVisitDateError,
    InvalidVeterinaryVisitObservationsError,
    InvalidVeterinaryVisitDiagnosisError,
    PetNotFoundError,
} from '../record-pet-veterinary-visit/record-pet-veterinary-visit';

export interface UpdatePetVeterinaryVisitCommand {
    petId: string;
    visitId: string;
    authenticatedAccountId: string;
    reason?: string;
    visitDate?: string;
    diagnosis?: string | null;
    observations?: string | null;
}

export interface UpdatedPetVeterinaryVisit {
    id: string;
    petId: string;
    reason: string;
    visitDate: string;
    diagnosis: string | null;
    observations: string | null;
    recordedByAccountId: string;
}

export class PetVeterinaryVisitNotFoundError extends Error {
    constructor() {
        super('Pet veterinary visit was not found');
    }
}

export class UpdatePetVeterinaryVisit {
    constructor(
        private readonly repository: PetVeterinaryVisitRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: UpdatePetVeterinaryVisitCommand): Promise<UpdatedPetVeterinaryVisit> {
        try {
            const outcome = await this.repository.correctIfPetWritable({
                ...command,
                getToday: (): string => this.clock.now().toISOString().slice(0, 10),
            });

            if (outcome.status === 'PET_NOT_FOUND') {
                throw new PetNotFoundError();
            }

            if (outcome.status === 'PET_VETERINARY_VISIT_NOT_FOUND') {
                throw new PetVeterinaryVisitNotFoundError();
            }

            const visit = outcome.visit;

            return {
                id: visit.id.value,
                petId: visit.petId.value,
                reason: visit.reason.value,
                visitDate: visit.visitDate.value,
                diagnosis: visit.diagnosis,
                observations: visit.observations,
                recordedByAccountId: visit.recordedByAccountId.value,
            };
        } catch (error: unknown) {
            if (error instanceof InvalidVeterinaryVisitReasonValueError) {
                throw new InvalidVeterinaryVisitReasonError(error);
            }

            if (error instanceof InvalidVeterinaryVisitDateValueError) {
                throw new InvalidVeterinaryVisitDateError(error);
            }

            if (error instanceof InvalidVeterinaryVisitObservationsValueError) {
                throw new InvalidVeterinaryVisitObservationsError(error);
            }

            if (error instanceof InvalidVeterinaryVisitDiagnosisValueError) {
                throw new InvalidVeterinaryVisitDiagnosisError(error);
            }

            throw error;
        }
    }
}
