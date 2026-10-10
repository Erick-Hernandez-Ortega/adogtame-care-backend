import {
    InvalidAllergenValueError,
    InvalidAllergyCategoryValueError,
    InvalidAllergySeverityValueError,
    InvalidAllergyNotesValueError,
} from '../../domain/pet-allergy/pet-allergy';
import type { PetAllergyRepository } from '../persistence/pet-allergy.repository';
import {
    InvalidAllergenError,
    InvalidAllergyCategoryError,
    InvalidAllergySeverityError,
    InvalidAllergyNotesError,
    PetNotFoundError,
    type RecordedPetAllergy as UpdatedPetAllergy,
} from '../record-pet-allergy/record-pet-allergy';

export interface UpdatePetAllergyCommand {
    petId: string;
    allergyId: string;
    authenticatedAccountId: string;
    allergen?: string;
    category?: string;
    severity?: string;
    notes?: string | null;
}
export type { UpdatedPetAllergy };

export class PetAllergyNotFoundError extends Error {
    constructor() {
        super('Pet allergy was not found');
    }
}

export class UpdatePetAllergy {
    constructor(private readonly repository: PetAllergyRepository) {}

    async execute(command: UpdatePetAllergyCommand): Promise<UpdatedPetAllergy> {
        try {
            const outcome = await this.repository.correctIfPetWritable(command);

            if (outcome.status === 'PET_NOT_FOUND') {
                throw new PetNotFoundError();
            }

            if (outcome.status === 'PET_ALLERGY_NOT_FOUND') {
                throw new PetAllergyNotFoundError();
            }

            const allergy = outcome.allergy;

            return {
                id: allergy.id.value,
                petId: allergy.petId.value,
                allergen: allergy.allergen.value,
                category: allergy.category,
                severity: allergy.severity,
                notes: allergy.notes,
                recordedByAccountId: allergy.recordedByAccountId.value,
            };
        } catch (error: unknown) {
            if (error instanceof InvalidAllergenValueError) {
                throw new InvalidAllergenError(error);
            }

            if (error instanceof InvalidAllergyCategoryValueError) {
                throw new InvalidAllergyCategoryError(error);
            }

            if (error instanceof InvalidAllergySeverityValueError) {
                throw new InvalidAllergySeverityError(error);
            }

            if (error instanceof InvalidAllergyNotesValueError) {
                throw new InvalidAllergyNotesError(error);
            }

            throw error;
        }
    }
}
