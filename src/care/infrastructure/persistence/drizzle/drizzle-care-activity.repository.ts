import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    pets,
    petMemberships,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CareActivityRepository,
    CreateCareActivityOutcome,
} from '../../../application/persistence/care-activity.repository';
import type { CareActivity } from '../../../domain/care-activity/care-activity';
import { careActivities, careRoutines } from './care.schema';

@Injectable()
export class DrizzleCareActivityRepository implements CareActivityRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async createIfPetWritable(
        activity: CareActivity,
        authenticatedAccountId: string,
    ): Promise<CreateCareActivityOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<CreateCareActivityOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, activity.petId.value))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return 'PET_NOT_FOUND';
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, activity.petId.value),
                            eq(petMemberships.accountId, authenticatedAccountId),
                        ),
                    )
                    .for('update');
                const membership = membershipRows[0];

                if (
                    membership?.status !== 'ACTIVE' ||
                    (membership.role !== 'OWNER' && membership.role !== 'COLLABORATOR')
                ) {
                    return 'PET_NOT_FOUND';
                }

                const routineRows = await transaction
                    .select({ id: careRoutines.id })
                    .from(careRoutines)
                    .where(
                        and(
                            eq(careRoutines.id, activity.routineId.value),
                            eq(careRoutines.petId, activity.petId.value),
                        ),
                    )
                    .for('update');

                if (routineRows[0] === undefined) {
                    return 'CARE_ROUTINE_NOT_FOUND';
                }

                await transaction.insert(careActivities).values({
                    id: activity.id.value,
                    petId: activity.petId.value,
                    routineId: activity.routineId.value,
                    completedAt: new Date(activity.completedAt.value),
                    completedBy: activity.completedBy.value,
                    timezone: activity.timezone.value,
                    notes: activity.notes?.value ?? null,
                });

                return 'CREATED';
            },
            { isolationLevel: 'read committed' },
        );
    }
}
