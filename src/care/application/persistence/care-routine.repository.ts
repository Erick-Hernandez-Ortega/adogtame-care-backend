import type { CareRoutine } from '../../domain/care-routine/care-routine';

export const CARE_ROUTINE_REPOSITORY: unique symbol = Symbol('CARE_ROUTINE_REPOSITORY');
export type CreateCareRoutineOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface CareRoutineRepository {
    createIfPetWritable(
        routine: CareRoutine,
        authenticatedAccountId: string,
    ): Promise<CreateCareRoutineOutcome>;
}
