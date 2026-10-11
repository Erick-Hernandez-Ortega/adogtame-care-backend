import { normalizeRequiredText } from '../../../shared/domain/text';
import { generateUuid, normalizeUuid } from '../../../shared/domain/uuid';
import { Allergen } from '../allergen/allergen';

export class PetAllergyId {
    private constructor(readonly value: string) {}

    static from(value: string): PetAllergyId {
        return new PetAllergyId(normalizeUuid(value, 'Pet allergy ID'));
    }

    static generate(): PetAllergyId {
        return new PetAllergyId(generateUuid());
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

export const AllergyCategory = {
    FOOD: 'FOOD',
    MEDICATION: 'MEDICATION',
    ENVIRONMENTAL: 'ENVIRONMENTAL',
    OTHER: 'OTHER',
} as const;
export type AllergyCategory = (typeof AllergyCategory)[keyof typeof AllergyCategory];

export const AllergySeverity = {
    MILD: 'MILD',
    MODERATE: 'MODERATE',
    SEVERE: 'SEVERE',
    UNKNOWN: 'UNKNOWN',
} as const;
export type AllergySeverity = (typeof AllergySeverity)[keyof typeof AllergySeverity];

export class InvalidAllergyCategoryValueError extends TypeError {
    constructor() {
        super('Allergy category must be FOOD, MEDICATION, ENVIRONMENTAL, or OTHER');
    }
}
export class InvalidAllergySeverityValueError extends TypeError {
    constructor() {
        super('Allergy severity must be MILD, MODERATE, SEVERE, or UNKNOWN');
    }
}
export class InvalidAllergyNotesValueError extends TypeError {
    constructor(message: string) {
        super(message);
    }
}

export class InvalidAllergenValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

interface ReconstitutePetAllergyInput extends CreatePetAllergyInput {
    id: PetAllergyId;
}

interface CorrectPetAllergyInput {
    allergen?: string;
    category?: string;
    severity?: string;
    notes?: string | null;
}

interface ValidatedPetAllergyInformation {
    category: AllergyCategory;
    severity: AllergySeverity;
    notes: string | null;
}

interface CreatePetAllergyInput {
    petId: PetId;
    allergen: Allergen;
    category: string;
    severity: string;
    notes?: string | null;
    recordedByAccountId: RecordedByAccountId;
}

export class PetAllergy {
    private constructor(
        readonly id: PetAllergyId,
        readonly petId: PetId,
        readonly allergen: Allergen,
        readonly category: AllergyCategory,
        readonly severity: AllergySeverity,
        readonly notes: string | null,
        readonly recordedByAccountId: RecordedByAccountId,
    ) {}

    static create(input: CreatePetAllergyInput): PetAllergy {
        const { category, severity, notes } = PetAllergy.validate(input);

        return new PetAllergy(
            PetAllergyId.generate(),
            input.petId,
            input.allergen,
            category,
            severity,
            notes,
            input.recordedByAccountId,
        );
    }

    static reconstitute(input: ReconstitutePetAllergyInput): PetAllergy {
        if (!(input.id instanceof PetAllergyId)) {
            throw new TypeError('Pet allergy data is invalid');
        }

        const { category, severity, notes } = PetAllergy.validate(input);

        return new PetAllergy(
            input.id,
            input.petId,
            input.allergen,
            category,
            severity,
            notes,
            input.recordedByAccountId,
        );
    }

    correct(input: CorrectPetAllergyInput): PetAllergy {
        if (
            input.allergen === undefined &&
            input.category === undefined &&
            input.severity === undefined &&
            input.notes === undefined
        ) {
            throw new TypeError('Pet allergy correction is invalid');
        }

        let allergen: Allergen = this.allergen;

        if (input.allergen !== undefined) {
            try {
                allergen = Allergen.from(input.allergen);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidAllergenValueError(error);
                }

                throw error;
            }
        }

        const candidate: PetAllergy = PetAllergy.reconstitute({
            id: this.id,
            petId: this.petId,
            allergen,
            category: input.category === undefined ? this.category : input.category,
            severity: input.severity === undefined ? this.severity : input.severity,
            notes: input.notes === undefined ? this.notes : input.notes,
            recordedByAccountId: this.recordedByAccountId,
        });

        if (
            candidate.allergen.value === this.allergen.value &&
            candidate.category === this.category &&
            candidate.severity === this.severity &&
            candidate.notes === this.notes
        ) {
            return this;
        }

        return candidate;
    }

    private static validate(input: CreatePetAllergyInput): ValidatedPetAllergyInformation {
        if (
            !(input.petId instanceof PetId) ||
            !(input.allergen instanceof Allergen) ||
            !(input.recordedByAccountId instanceof RecordedByAccountId)
        ) {
            throw new TypeError('Pet allergy data is invalid');
        }

        const category: AllergyCategory = PetAllergy.category(input.category);
        const severity: AllergySeverity = PetAllergy.severity(input.severity);
        const notes: string | null = PetAllergy.notes(input.notes);

        return { category, severity, notes };
    }

    private static category(value: string): AllergyCategory {
        switch (value) {
            case AllergyCategory.FOOD:
            case AllergyCategory.MEDICATION:
            case AllergyCategory.ENVIRONMENTAL:
            case AllergyCategory.OTHER:
                return value;
            default:
                throw new InvalidAllergyCategoryValueError();
        }
    }

    private static severity(value: string): AllergySeverity {
        switch (value) {
            case AllergySeverity.MILD:
            case AllergySeverity.MODERATE:
            case AllergySeverity.SEVERE:
            case AllergySeverity.UNKNOWN:
                return value;
            default:
                throw new InvalidAllergySeverityValueError();
        }
    }

    private static notes(value: string | null | undefined): string | null {
        if (value === undefined || value === null) {
            return null;
        }

        try {
            return normalizeRequiredText(value, 'Allergy notes', 2000);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidAllergyNotesValueError(error.message);
            }

            throw error;
        }
    }
}
