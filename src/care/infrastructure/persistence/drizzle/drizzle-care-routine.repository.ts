import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
    CareRoutineRepository,
    CareRoutineCorrection,
    UpdateCareRoutineOutcome,
    CreateCareRoutineOutcome,
} from '../../../application/persistence/care-routine.repository';
import {
    CareRoutine,
    CareRoutineId,
    PetId,
    RecordedByAccountId,
} from '../../../domain/care-routine/care-routine';
import { CareRoutineType } from '../../../domain/routine-type/routine-type';
import { RoutineTitle } from '../../../domain/routine-title/routine-title';
import { RoutineInstructions } from '../../../domain/routine-instructions/routine-instructions';
import { RoutineFrequency } from '../../../domain/routine-frequency/routine-frequency';
import { RoutineTimezone } from '../../../domain/routine-timezone/routine-timezone';
import { careRoutines } from './care.schema';

@Injectable()
export class DrizzleCareRoutineRepository implements CareRoutineRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async correctIfPetWritable(
        correction: CareRoutineCorrection,
    ): Promise<UpdateCareRoutineOutcome> {
        return this.databaseService.connection.transaction(
            async (transaction): Promise<UpdateCareRoutineOutcome> => {
                const petRows = await transaction
                    .select({ status: pets.status })
                    .from(pets)
                    .where(eq(pets.id, correction.petId))
                    .for('update');

                if (petRows[0]?.status !== 'ACTIVE') {
                    return { status: 'PET_NOT_FOUND' };
                }

                const membershipRows = await transaction
                    .select({ role: petMemberships.role, status: petMemberships.status })
                    .from(petMemberships)
                    .where(
                        and(
                            eq(petMemberships.petId, correction.petId),
                            eq(petMemberships.accountId, correction.authenticatedAccountId),
                        ),
                    )
                    .for('update');
                const membership = membershipRows[0];

                if (
                    membership?.status !== 'ACTIVE' ||
                    (membership.role !== 'OWNER' && membership.role !== 'COLLABORATOR')
                ) {
                    return { status: 'PET_NOT_FOUND' };
                }

                const routineRows = await transaction
                    .select()
                    .from(careRoutines)
                    .where(
                        and(
                            eq(careRoutines.id, correction.routineId),
                            eq(careRoutines.petId, correction.petId),
                        ),
                    )
                    .for('update');
                const row = routineRows[0];

                if (row === undefined) {
                    return { status: 'CARE_ROUTINE_NOT_FOUND' };
                }

                const routine: CareRoutine = CareRoutine.reconstitute({
                    id: CareRoutineId.from(row.id),
                    petId: PetId.from(row.petId),
                    type: CareRoutineType.from(row.type),
                    title: RoutineTitle.from(row.title),
                    instructions:
                        row.instructions === null
                            ? null
                            : RoutineInstructions.from(row.instructions),
                    frequency: RoutineFrequency.from({
                        period: row.frequencyPeriod,
                        timesPerPeriod: row.timesPerPeriod,
                        suggestedTimes: row.suggestedTimes,
                        weekdays: row.weekdays,
                    }),
                    timezone: RoutineTimezone.from(row.timezone),
                    recordedByAccountId: RecordedByAccountId.from(row.recordedByAccountId),
                });
                const corrected: CareRoutine = routine.correct(correction);

                if (corrected === routine) {
                    return { status: 'UNCHANGED', routine };
                }

                await transaction
                    .update(careRoutines)
                    .set({
                        type: corrected.type.value,
                        title: corrected.title.value,
                        instructions: corrected.instructions?.value ?? null,
                        frequencyPeriod: corrected.frequency.period,
                        timesPerPeriod: corrected.frequency.timesPerPeriod,
                        suggestedTimes: [...corrected.frequency.suggestedTimes],
                        weekdays: [...corrected.frequency.weekdays],
                        timezone: corrected.timezone.value,
                    })
                    .where(
                        and(
                            eq(careRoutines.id, correction.routineId),
                            eq(careRoutines.petId, correction.petId),
                        ),
                    );

                return { status: 'UPDATED', routine: corrected };
            },
            { isolationLevel: 'read committed' },
        );
    }

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
