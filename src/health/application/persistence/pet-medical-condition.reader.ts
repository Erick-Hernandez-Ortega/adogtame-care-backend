import type { PageRequest, PageRow } from '../../../shared/application/pagination';
import type { MedicalConditionStatus } from '../../domain/pet-medical-condition/pet-medical-condition';

export const PET_MEDICAL_CONDITION_READER: unique symbol = Symbol('PET_MEDICAL_CONDITION_READER');

export interface PetMedicalConditionListItem extends PageRow {
    readonly id: string;
    readonly name: string;
    readonly status: MedicalConditionStatus;
    readonly resolvedDate: string | null;
    readonly diagnosedDate: string | null;
    readonly notes: string | null;
    readonly recordedByAccountId: string;
}

export interface PetMedicalConditionReadRequest {
    readonly page?: PageRequest;
    readonly petId: string;
    readonly accountId: string;
}

export interface PetMedicalConditionReader {
    findAccessibleByPet(
        request: PetMedicalConditionReadRequest,
    ): Promise<PetMedicalConditionListItem[] | null>;
}
