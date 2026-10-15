import type { PageRequest, PageRow } from '../../../shared/application/pagination';
export const PET_VETERINARY_VISIT_READER: unique symbol = Symbol('PET_VETERINARY_VISIT_READER');

export interface PetVeterinaryVisitListItem extends PageRow {
    readonly id: string;
    readonly visitDate: string;
    readonly reason: string;
    readonly diagnosis: string | null;
    readonly observations: string | null;
    readonly recordedByAccountId: string;
}

export interface PetVeterinaryVisitReadRequest {
    readonly page?: PageRequest;
    readonly petId: string;
    readonly accountId: string;
}

export interface PetVeterinaryVisitReader {
    findAccessibleByPet(
        request: PetVeterinaryVisitReadRequest,
    ): Promise<PetVeterinaryVisitListItem[] | null>;
}
