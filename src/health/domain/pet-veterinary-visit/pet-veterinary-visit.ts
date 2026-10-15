import { normalizeRequiredText } from '../../../shared/domain/text';
import { generateUuid, normalizeUuid } from '../../../shared/domain/uuid';
import { VisitDate } from '../visit-date/visit-date';
import { VeterinaryVisitReason } from '../veterinary-visit-reason/veterinary-visit-reason';

export class PetVeterinaryVisitId {
    private constructor(readonly value: string) {}

    static from(value: string): PetVeterinaryVisitId {
        return new PetVeterinaryVisitId(normalizeUuid(value, 'Pet veterinary visit ID'));
    }

    static generate(): PetVeterinaryVisitId {
        return new PetVeterinaryVisitId(generateUuid());
    }
}

export class PetId {
    private constructor(readonly value: string) {}

    static from(value: string): PetId {
        return new PetId(normalizeUuid(value, 'Pet ID'));
    }
}

export class RecordedByAccountId {
    private constructor(readonly value: string) {}

    static from(value: string): RecordedByAccountId {
        return new RecordedByAccountId(normalizeUuid(value, 'Account ID'));
    }
}

export class InvalidVeterinaryVisitDiagnosisValueError extends TypeError {}
export class InvalidVeterinaryVisitObservationsValueError extends TypeError {}

interface CreatePetVeterinaryVisitInput {
    petId: PetId;
    visitDate: VisitDate;
    reason: VeterinaryVisitReason;
    diagnosis?: string | null;
    observations?: string | null;
    recordedByAccountId: RecordedByAccountId;
}

interface ReconstitutePetVeterinaryVisitInput extends CreatePetVeterinaryVisitInput {
    id: PetVeterinaryVisitId;
}

export class PetVeterinaryVisit {
    private constructor(
        readonly id: PetVeterinaryVisitId,
        readonly petId: PetId,
        readonly visitDate: VisitDate,
        readonly reason: VeterinaryVisitReason,
        readonly diagnosis: string | null,
        readonly observations: string | null,
        readonly recordedByAccountId: RecordedByAccountId,
    ) {}

    static create(input: CreatePetVeterinaryVisitInput): PetVeterinaryVisit {
        return PetVeterinaryVisit.reconstitute({ ...input, id: PetVeterinaryVisitId.generate() });
    }

    static reconstitute(input: ReconstitutePetVeterinaryVisitInput): PetVeterinaryVisit {
        if (
            !(input.id instanceof PetVeterinaryVisitId) ||
            !(input.petId instanceof PetId) ||
            !(input.visitDate instanceof VisitDate) ||
            !(input.reason instanceof VeterinaryVisitReason) ||
            !(input.recordedByAccountId instanceof RecordedByAccountId)
        ) {
            throw new TypeError('Pet veterinary visit data is invalid');
        }

        let diagnosis: string | null = null;
        let observations: string | null = null;

        if (input.diagnosis !== undefined && input.diagnosis !== null) {
            try {
                diagnosis = normalizeRequiredText(
                    input.diagnosis,
                    'Veterinary visit diagnosis',
                    2000,
                );
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidVeterinaryVisitDiagnosisValueError(error.message);
                }

                throw error;
            }
        }

        if (input.observations !== undefined && input.observations !== null) {
            try {
                observations = normalizeRequiredText(
                    input.observations,
                    'Veterinary visit observations',
                    5000,
                );
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidVeterinaryVisitObservationsValueError(error.message);
                }

                throw error;
            }
        }

        return new PetVeterinaryVisit(
            input.id,
            input.petId,
            input.visitDate,
            input.reason,
            diagnosis,
            observations,
            input.recordedByAccountId,
        );
    }
}
