import type { PetVeterinaryVisit } from '../../domain/pet-veterinary-visit/pet-veterinary-visit';

export const PET_VETERINARY_VISIT_REPOSITORY: unique symbol = Symbol(
    'PET_VETERINARY_VISIT_REPOSITORY',
);
export type CreatePetVeterinaryVisitOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface PetVeterinaryVisitRepository {
    createIfPetWritable(
        visit: PetVeterinaryVisit,
        authenticatedAccountId: string,
    ): Promise<CreatePetVeterinaryVisitOutcome>;
}
