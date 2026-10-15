import type { CorrectCareRoutineInput, CareRoutine } from '../../domain/care-routine/care-routine';

export const CARE_ROUTINE_REPOSITORY: unique symbol = Symbol('CARE_ROUTINE_REPOSITORY');
export type CreateCareRoutineOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface CareRoutineCorrection extends CorrectCareRoutineInput {
    petId: string;
    routineId: string;
    authenticatedAccountId: string;
}

export type UpdateCareRoutineOutcome =
    | { status: 'UPDATED' | 'UNCHANGED'; routine: CareRoutine }
    | { status: 'PET_NOT_FOUND' }
    | { status: 'CARE_ROUTINE_NOT_FOUND' };

export interface CareRoutineRepository {
    correctIfPetWritable(correction: CareRoutineCorrection): Promise<UpdateCareRoutineOutcome>;

    createIfPetWritable(
        routine: CareRoutine,
        authenticatedAccountId: string,
    ): Promise<CreateCareRoutineOutcome>;
}
