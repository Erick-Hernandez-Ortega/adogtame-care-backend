export const PET_VETERINARY_VISIT_READER: unique symbol = Symbol('PET_VETERINARY_VISIT_READER');

export interface PetVeterinaryVisitListItem {
    readonly id: string;
    readonly visitDate: string;
    readonly reason: string;
    readonly diagnosis: string | null;
    readonly observations: string | null;
    readonly recordedByAccountId: string;
}

export interface PetVeterinaryVisitReadRequest {
    readonly petId: string;
    readonly accountId: string;
}

export interface PetVeterinaryVisitReader {
    findAccessibleByPet(
        request: PetVeterinaryVisitReadRequest,
    ): Promise<PetVeterinaryVisitListItem[] | null>;
}
