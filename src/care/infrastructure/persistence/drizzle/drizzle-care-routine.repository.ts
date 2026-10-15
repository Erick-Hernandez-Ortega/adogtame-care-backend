import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CareRoutineRepository,
    CreateCareRoutineOutcome,
} from '../../../application/persistence/care-routine.repository';
import type { CareRoutine } from '../../../domain/care-routine/care-routine';
import { careRoutines } from './care.schema';

@Injectable()
export class DrizzleCareRoutineRepository implements CareRoutineRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async createIfPetWritable(
        routine: CareRoutine,
        authenticatedAccountId: string,
    ): Promise<CreateCareRoutineOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<CreateCareRoutineOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, routine.petId.value))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return 'PET_NOT_FOUND';
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, routine.petId.value),
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

                await transaction.insert(careRoutines).values({
                    id: routine.id.value,
                    petId: routine.petId.value,
                    type: routine.type.value,
                    title: routine.title.value,
                    instructions: routine.instructions?.value ?? null,
                    frequencyPeriod: routine.frequency.period,
                    timesPerPeriod: routine.frequency.timesPerPeriod,
                    suggestedTimes: [...routine.frequency.suggestedTimes],
                    weekdays: [...routine.frequency.weekdays],
                    timezone: routine.timezone.value,
                    recordedByAccountId: routine.recordedByAccountId.value,
                });

                return 'CREATED';
            },
            { isolationLevel: 'read committed' },
        );
    }
}
