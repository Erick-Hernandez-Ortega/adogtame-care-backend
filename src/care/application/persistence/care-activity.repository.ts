import type { CareActivity } from '../../domain/care-activity/care-activity';

export const CARE_ACTIVITY_REPOSITORY: unique symbol = Symbol('CARE_ACTIVITY_REPOSITORY');
export type CreateCareActivityOutcome = 'CREATED' | 'PET_NOT_FOUND' | 'CARE_ROUTINE_NOT_FOUND';

export interface CareActivityRepository {
    createIfPetWritable(
        activity: CareActivity,
        authenticatedAccountId: string,
    ): Promise<CreateCareActivityOutcome>;
}
