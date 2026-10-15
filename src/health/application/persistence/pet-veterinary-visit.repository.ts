import type { PetVeterinaryVisit } from '../../domain/pet-veterinary-visit/pet-veterinary-visit';

export const PET_VETERINARY_VISIT_REPOSITORY: unique symbol = Symbol(
    'PET_VETERINARY_VISIT_REPOSITORY',
);
export type CreatePetVeterinaryVisitOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface PetVeterinaryVisitCorrection {
    petId: string;
    visitId: string;
    authenticatedAccountId: string;
    visitDate?: string;
    reason?: string;
    diagnosis?: string | null;
    observations?: string | null;
    getToday: () => string;
}

export type UpdatePetVeterinaryVisitOutcome =
    | { status: 'UPDATED' | 'UNCHANGED'; visit: PetVeterinaryVisit }
    | { status: 'PET_NOT_FOUND' }
    | { status: 'PET_VETERINARY_VISIT_NOT_FOUND' };

export interface PetVeterinaryVisitRepository {
    correctIfPetWritable(
        correction: PetVeterinaryVisitCorrection,
    ): Promise<UpdatePetVeterinaryVisitOutcome>;
    createIfPetWritable(
        visit: PetVeterinaryVisit,
        authenticatedAccountId: string,
    ): Promise<CreatePetVeterinaryVisitOutcome>;
}
